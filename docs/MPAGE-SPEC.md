# .mpage formati — spetsifikatsiya v2.0

`.mpage` — har qanday fayllarni **tartib bilan** saqlaydigan bitta arxiv fayl:

```
arxiv.mpage
└── Session            (masalan: 456_SPG_425XVC)
    └── Sector         (masalan: SECTOR_004 · CONFIDENTIAL)
        └── Fayllar    (PDF, rasm, video, audio, matn, istalgan fayl)
```

MIME turi: `application/x-mpage` · Kengaytma: `.mpage`

## Fayllar qanday saqlanadi?

`.mpage` fayllarga **yo'l (path)** emas, ularning **baytlarini** saqlaydi:

- arxivni boshqa papkaga, fleshkaga, boshqa kompyuterga ko'chirsangiz ham hamma fayl ichida — asl papkalar kerak emas;
- sifat o'zgarmaydi: PNG/JPEG/MP4/MP3/PDF kabi siqilgan formatlar **qayta siqilmasdan** saqlanadi (bit-ma-bit bir xil);
- matnli fayllar (txt, json, csv…) siqiladi — joy tejaladi;
- har bir fayl SHA-256 summasi bilan yoziladi va ochishda tekshiriladi — buzilgan fayl darhol aniqlanadi.

## Konteyner tuzilishi (ZIP)

```
mimetype                                         "application/x-mpage" — 1-yozuv, siqilmagan
manifest.json                                    daraxt + metadata
sessions/456_SPG_425XVC/SECTOR_004/invoice.pdf
sessions/456_SPG_425XVC/SECTOR_004/manifest.csv
sessions/456_SPG_425XVC/SECTOR_022/RS_SCHEMATIC_03.png
sessions/Media_Lab_34/AUDIO/chord_A.wav
…
```

Ichki yo'llar o'qiladigan va tartibli: istalgan ZIP dasturi bilan ham ochib ko'rish mumkin.
`mimetype` birinchi va siqilmagan bo'lgani uchun fayl turi 30-baytdan aniqlanadi
(`mimetypeapplication/x-mpage`) — Linux `shared-mime-info` shu orqali taniydi.

Nomlardagi taqiqlangan belgilar (`\ / : * ? " < > |`) `_` ga almashtiriladi; bir sektorda bir xil nom
bo'lsa `fayl (2).ext` ko'rinishida farqlanadi. Asl nom `manifest.json` da saqlanadi.

## manifest.json

```json
{
  "format": "mpage",
  "version": "2.0",
  "id": "mpage-k3j9x0a1",
  "title": "demo",
  "created": "2026-11-01T12:00:00.000Z",
  "modified": "2026-11-01T12:30:00.000Z",
  "generator": "MPage/2.0",
  "sessions": [
    {
      "id": "ses-…", "name": "456_SPG_425XVC", "code": "456_SPG_425XVC", "created": "…",
      "sectors": [
        {
          "id": "sec-…", "name": "SECTOR_004", "level": "confidential", "color": "#1d3a8a",
          "files": [
            { "id": "file-…", "name": "2365_SHIPPING_LS.pdf", "mime": "application/pdf", "size": 1434,
              "sha256": "9f2c…", "added": "…", "path": "sessions/456_SPG_425XVC/SECTOR_004/2365_SHIPPING_LS.pdf" }
          ]
        }
      ]
    }
  ]
}
```

Sessionlar, sektorlar va fayllar tartibi massivdagi tartib bilan belgilanadi.

### Maxfiylik darajalari (`level`)

| level | yorliq | standart rang |
|---|---|---|
| `public` | PUBLIC | `#64748b` |
| `internal` | INTERNAL | `#0e7490` |
| `confidential` | CONFIDENTIAL | `#1d3a8a` |
| `restricted` | RESTRICTED | `#2563eb` |
| `top-secret` | TOP SECRET | `#d97706` |
| `ultra-secret` | ULTRA SECRET | `#eab308` |
| `secret` | SECRET | `#b91c1c` |
| `cosmic` | COSMIC | `#06b6d4` |

`color` ixtiyoriy ravishda o'zgartirilishi mumkin.

O'quvchi `version` ning asosiy raqami o'zi qo'llaydigandan katta bo'lsa, faylni rad etadi.

## Papka ⇄ .mpage (CLI)

```
papka/
├── 456_SPG_425XVC/            → session
│   ├── _session.json          { "code": "456_SPG_425XVC" }   (ixtiyoriy)
│   ├── SECTOR_004/            → sektor
│   │   ├── _sector.json       { "level": "confidential" }    (ixtiyoriy)
│   │   └── invoice.pdf        → fayl
│   └── loose.txt              → "General" sektoriga tushadi
```

## Parol bilan himoya (v2.1)

Butun **session** yoki alohida **sektor** parol bilan shifrlanishi mumkin. **Har xil parol — har xil ruxsat**:
masalan `A` paroli `Operatsiyalar` va `Arxiv` sessionlarini, `B` paroli faqat `Operatsiyalar / SECTOR_042` ni ochadi.
Sektor paroli sessiondan mustaqil: sessionni ochgan odam ichidagi yopiq sektorni ko'rmaydi.

```
parol ──Argon2id(salt, 64 MiB, 4 iter.)──▶ KEK
KEK ──AES-256-GCM──▶ kalit uyasi (keyslot) = { kind, keys: { sessionId | sectorId: DEK, … } }
DEK (har bir session/sektor uchun tasodifiy 256 bit) ──AES-256-GCM──▶ meta + har bir fayl
```

- **Nima shifrlanadi:** session nomi, kodi, sektorlar (nomi), fayl nomlari, turlari va fayllarning o'zi.
  Parolsiz faqat shifrlangan qismlar soni, taxminiy hajmi va **sektor maxfiylik darajasi** (masalan qulf belgisi bilan `SECRET`) ko'rinadi.
- Himoyalangan session ichidagi alohida himoyalangan sektor ikki qatlam bilan shifrlanadi; uni ochish uchun
  sessionga ham, sektorga ham ruxsat kerak (bitta parol ikkalasini bersa — bittasi kifoya).
- **Kalit uyasi** nimani ochishini ham shifrlangan holda saqlaydi — bir parol egasi boshqa parollar nimaga ruxsat berishini bilmaydi.
- **Parolni o'zgartirish** ma'lumotni qayta shifrlamaydi: faqat uya yangi KEK bilan yopiladi. Saqlangandan keyin eski parol ishlamaydi.
- **Tiklash kaliti** (`kind: "recovery"`) — 200 bitli kod (`XXXXX-…` × 8). U yaratilgan paytda ochiq bo'lgan barcha
  himoyalangan qismlarni ochadi; bir marta ko'rsatiladi, qog'ozga yozib saqlanadi.
- Har bir blok yangi tasodifiy 96-bit IV bilan shifrlanadi va AAD (`<sessionId>/<faylId>`) bilan bog'lanadi:
  shifrmatnni o'zgartirish yoki bloklarni almashtirish GCM tomonidan aniqlanadi.
- Argon2id xotiraga og'ir: har bir taxmin 64 MB RAM va ~0.3 s talab qiladi, bu GPU/ASIC bilan ommaviy terishni juda qimmat qiladi.
- Zaif parollar rad etiladi (taxminan 70 bitdan kam; `So'z2024!` shaklidagi va mashhur so'zli parollar).
  Ilova 100 bitli tasodifiy parol yaratib bera oladi: `K7QF-M2XP-9WBT-R4HZ-QQ3N`.

**Buzib bo'lmaslik sharti:** AES-256 va Argon2id ning o'zi amalda buzilmaydi; xavf faqat parolning o'zida.
100 bitli parolni 1 million GPU bilan terish koinot yoshidan ko'p vaqt oladi. Lekin:
- parolni unutsangiz — ma'lumotni **hech kim tiklay olmaydi** (orqa eshik yo'q);
- ochilgan session ma'lumotlari ilova ishlayotganda xotirada ochiq turadi — "Hammasini qulflash" kalitlarni xotiradan o'chiradi;
- `mpage unpack` ochilgan fayllarni diskka **shifrlanmagan** holda yozadi.

**Ilovadagi qo'shimcha himoya** (shu kompyuter sozlamalari, faylda saqlanmaydi):
- **Avto-qulflash** — N daqiqa harakatsizlikdan keyin (standart 5) yoki oyna yashirilganda kalitlar xotiradan o'chiriladi.
  Ochiq tahrir yo'qolmaydi — u avval faylga yoziladi, keyin hammasi bilan birga shifrlanadi.
- **Urinishlar cheklovi** — 3 ta xatodan keyin kutish 5 s, 10 s, 20 s … 5 daqiqagacha oshadi (ilova qayta ochilsa ham saqlanadi).
  Bu faqat ilova ichidagi to'siq; faylni boshqa dasturda terishga qarshi asosiy himoya — kuchli parol va Argon2id.
- **Ekran klaviaturasi** — parolni qo'l (pinch) yoki sichqoncha bilan terish; tugmalar har bosishda aralashtiriladi,
  shuning uchun qo'l harakatini kuzatgan odam (yoki kamera yozuvi) qaysi belgi terilganini bilolmaydi.
- MediaPipe kutubxonasining Google'ga telemetriya yuborish urinishi Content-Security-Policy bilan bloklangan — ilova tarmoqqa chiqmaydi.

manifest.json da:

```json
"sessions": [
  { "id": "ses-…", "locked": true, "blobs": { "locked/ses-…/meta.bin": "<sha256>", "locked/ses-…/file-….bin": "<sha256>" } },
  { "id": "ses-…", "name": "Ochiq session", "sectors": [
      { "id": "sec-…", "locked": true, "level": "secret", "color": "#b91c1c", "blobs": { "locked/sec-…/meta.bin": "<sha256>", "…": "…" } }
  ] }
],
"security": {
  "kdf": { "alg": "argon2id", "memory": 65536, "iterations": 4, "parallelism": 1, "salt": "<base64>" },
  "cipher": "AES-256-GCM",
  "slots": ["<base64: iv ‖ shifrmatn ‖ teg>", "…"]
}
```

`blobs` dagi SHA-256 shifrmatn butunligini parolsiz tekshirish uchun (`mpage verify`).

CLI: `mpage protect arxiv.mpage --new "<yangi parol>" -s "<Session>" -s "<Session/Sektor>" [-p "<mavjud parol>"]`,
`mpage info|unpack|verify arxiv.mpage -p "<parol>"` (yoki `MPAGE_PASSWORD` muhit o'zgaruvchisi).

## Qo'l bilan boshqarish (MediaPipe Hand Landmarker)

| Imo-ishora | Amal |
|---|---|
| Bosh + ko'rsatkich barmoq | kursor |
| Qisqa pinch | bosish: session / sektor / faylni ochish |
| Pinch ushlab surish | ro'yxatni aylantirish, stopkani burish |
| Kaft yuqoriga / pastga | keyingi / oldingi sektor |
| Kaft chapga / o'ngga | keyingi / oldingi session (fayl ochiq bo'lsa — keyingi / oldingi fayl) |
| Musht (0.4 s) | orqaga: faylni → sektorni yopish |
| Ikki qo'l pinch | kattalashtirish (rasm yoki stopka) |
