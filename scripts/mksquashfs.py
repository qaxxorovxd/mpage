#!/usr/bin/env python3
"""
Minimal SquashFS 4.0 writer (xz compression, Python standard library only).

Used to build the AppImage on hosts without squashfs-tools (for example Windows).
Supports regular files, directories and symlinks; all entries are owned by root (uid/gid 0).
Unix permissions are taken from a JSON map (relative path -> octal mode) because the
host filesystem may not carry them.

Usage: python mksquashfs.py <source dir> <output file> [modes.json]
"""
import json
import lzma
import os
import struct
import sys
from concurrent.futures import ProcessPoolExecutor

BLOCK_SIZE = 1 << 17          # 128 KiB data blocks
BLOCK_LOG = 17
META_SIZE = 8192              # metadata block size
XZ_ID = 4
FLAG_NO_FRAGMENTS = 0x0010
FLAG_NO_XATTRS = 0x0200
INVALID = 0xFFFFFFFFFFFFFFFF
MTIME = 1_700_000_000          # fixed timestamp for reproducible images

T_DIR, T_FILE, T_SYMLINK = 1, 2, 3
FILTERS = [{"id": lzma.FILTER_LZMA2, "preset": 6, "dict_size": BLOCK_SIZE}]


def xz(data):
    return lzma.compress(data, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC32, filters=FILTERS)


class MetaWriter:
    """Metadata stream split into 8 KiB blocks, each compressed (or stored when that is smaller)."""

    def __init__(self):
        self.out = bytearray()
        self.buf = bytearray()

    def pos(self):
        # (start of the current block within the table, offset inside the uncompressed block)
        return len(self.out), len(self.buf)

    def write(self, data):
        self.buf += data
        while len(self.buf) >= META_SIZE:
            self._flush(bytes(self.buf[:META_SIZE]))
            del self.buf[:META_SIZE]

    def finish(self):
        if self.buf:
            self._flush(bytes(self.buf))
            self.buf = bytearray()
        return bytes(self.out)

    def _flush(self, chunk):
        packed = xz(chunk)
        if len(packed) < len(chunk):
            self.out += struct.pack('<H', len(packed)) + packed
        else:
            self.out += struct.pack('<H', len(chunk) | 0x8000) + chunk


class Node:
    def __init__(self, name, kind, mode, path=None, target=None):
        self.name, self.kind, self.mode, self.path, self.target = name, kind, mode, path, target
        self.children = []
        self.ino = 0
        self.ref = None          # (block, offset) of the inode
        self.blocks_start = 0
        self.block_sizes = []
        self.size = 0


def scan(root, modes, rel=''):
    """Builds the tree; children sorted by name bytes as SquashFS requires."""
    node = Node(os.path.basename(root) or '/', T_DIR, modes.get(rel, 0o755))
    for name in sorted(os.listdir(root), key=lambda n: n.encode()):
        full = os.path.join(root, name)
        r = f'{rel}/{name}' if rel else name
        if os.path.islink(full):
            node.children.append(Node(name, T_SYMLINK, 0o777, target=os.readlink(full)))
        elif os.path.isdir(full):
            child = scan(full, modes, r)
            child.name = name
            node.children.append(child)
        else:
            node.children.append(Node(name, T_FILE, modes.get(r, 0o644), path=full))
    return node


def walk_files(node):
    for c in node.children:
        if c.kind == T_FILE:
            yield c
        elif c.kind == T_DIR:
            yield from walk_files(c)


def number(node, counter):
    """Post-order inode numbers: children first, the root gets the highest number."""
    for c in node.children:
        if c.kind == T_DIR:
            number(c, counter)
        else:
            counter[0] += 1
            c.ino = counter[0]
    counter[0] += 1
    node.ino = counter[0]


def compress_block(block):
    packed = xz(block)
    return (packed, len(packed)) if len(packed) < len(block) else (block, len(block) | (1 << 24))


def header(kind, mode, ino):
    return struct.pack('<HHHHII', kind, mode & 0o7777, 0, 0, MTIME, ino)


def write_tree(node, parent_ino, inodes, dirs):
    # 1) inodes of files and symlinks, sub-directories recursively (post-order)
    for c in node.children:
        if c.kind == T_DIR:
            write_tree(c, node.ino, inodes, dirs)
        elif c.kind == T_FILE:
            c.ref = inodes.pos()
            inodes.write(header(T_FILE, c.mode, c.ino)
                         + struct.pack('<IIII', c.blocks_start, 0xFFFFFFFF, 0, c.size)
                         + b''.join(struct.pack('<I', s) for s in c.block_sizes))
        else:
            target = c.target.encode()
            c.ref = inodes.pos()
            inodes.write(header(T_SYMLINK, c.mode, c.ino) + struct.pack('<II', 1, len(target)) + target)

    # 2) directory listing, grouped under headers (same inode block, <= 256 entries, small inode deltas)
    listing_pos = dirs.pos()
    listing = bytearray()
    i = 0
    children = node.children
    while i < len(children):
        block = children[i].ref[0]
        base = children[i].ino
        group = []
        while i < len(children) and len(group) < 256 and children[i].ref[0] == block and abs(children[i].ino - base) < 32767:
            group.append(children[i])
            i += 1
        listing += struct.pack('<III', len(group) - 1, block, base)
        for c in group:
            name = c.name.encode()
            listing += struct.pack('<HhHH', c.ref[1], c.ino - base, c.kind, len(name) - 1) + name
    dirs.write(bytes(listing))
    if len(listing) + 3 > 0xFFFF:
        raise SystemExit(f'directory too large for a basic inode: {node.name}')

    # 3) the directory inode itself
    subdirs = sum(1 for c in children if c.kind == T_DIR)
    node.ref = inodes.pos()
    inodes.write(header(T_DIR, node.mode, node.ino)
                 + struct.pack('<IIHHI', listing_pos[0], 2 + subdirs, len(listing) + 3, listing_pos[1], parent_ino))


def main():
    src, out_path = sys.argv[1], sys.argv[2]
    modes = {}
    if len(sys.argv) > 3:
        with open(sys.argv[3], encoding='utf-8') as fh:
            modes = {k: int(v, 8) for k, v in json.load(fh).items()}

    root = scan(src, modes)
    counter = [0]
    number(root, counter)
    inode_count = counter[0]

    with open(out_path, 'wb') as out, ProcessPoolExecutor() as pool:
        out.write(b'\0' * 96)  # superblock, filled in at the end
        for f in walk_files(root):
            with open(f.path, 'rb') as fh:
                data = fh.read()
            f.size = len(data)
            f.blocks_start = out.tell()
            blocks = [data[i:i + BLOCK_SIZE] for i in range(0, len(data), BLOCK_SIZE)]
            for packed, size_field in pool.map(compress_block, blocks):
                out.write(packed)
                f.block_sizes.append(size_field)
        if out.tell() >= 1 << 32:
            raise SystemExit('image too large for basic file inodes (4 GiB)')

        inodes, dirs = MetaWriter(), MetaWriter()
        write_tree(root, inode_count + 1, inodes, dirs)

        inode_table_start = out.tell()
        out.write(inodes.finish())
        directory_table_start = out.tell()
        out.write(dirs.finish())
        fragment_table_start = out.tell()  # no fragments: empty table

        id_block_pos = out.tell()
        ids = MetaWriter()
        ids.write(struct.pack('<I', 0))  # single id: root
        out.write(ids.finish())
        id_table_start = out.tell()
        out.write(struct.pack('<Q', id_block_pos))

        bytes_used = out.tell()
        out.write(b'\0' * (-bytes_used % 4096))

        root_ref = (root.ref[0] << 16) | root.ref[1]
        out.seek(0)
        out.write(struct.pack('<IIIIIHHHHHHQQQQQQQQ',
                              0x73717368, inode_count, MTIME, BLOCK_SIZE, 0,
                              XZ_ID, BLOCK_LOG, FLAG_NO_FRAGMENTS | FLAG_NO_XATTRS, 1, 4, 0,
                              root_ref, bytes_used, id_table_start, INVALID,
                              inode_table_start, directory_table_start, fragment_table_start, INVALID))
    print(f'[ok] {out_path}: {inode_count} inodes, {bytes_used / 1048576:.1f} MiB')


if __name__ == '__main__':
    main()
