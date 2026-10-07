# ОДНА ВЕЩЬ ТЕБЕ ИЛИ ДВЕ ДРУГОМУ

Личный каталог вещей, которые я хочу передать дальше. Статический сайт на GitHub Pages:
без регистрации, базы данных и оплаты на сайте.

## Файлы

| Файл | Что внутри |
|---|---|
| `config.js` | название, текст главной, telegram, бегущая строка, правила передачи, идеи для подгона |
| `data/items.json` | каталог вещей (и архив) |
| `images/` | фотографии |
| `index.html`, `assets/` | код сайта |

В браузере посетителя хранятся только лайки, «моё» и выбранные намерения.
Заявки, бронь, очередь и логистика — в Telegram.

## Вещь (`data/items.json`)

Обязательные поля: `id`, `category`, `type`, `condition`, `deal`, `photos`, `added`, `status`.
Остальные — по желанию, пустые на сайте не показываются.

```json
{
  "id": "coat-cos-001",
  "title": "",                       // необязательно: по умолчанию «бренд · модель» или «бренд · тип»
  "category": "clothes",             // clothes | shoes | bags | accessories | jewelry | books | beauty | toys | home | other
  "type": "пальто",
  "brand": "COS",
  "model": "Wool Blend Coat",
  "size": "M",
  "fit": "сидит скорее как S–M",
  "author": "", "publisher": "",     // для книг
  "opened": false,                   // для косметики: открыта ли упаковка
  "condition": { "label": "как новая", "score": 9 },   // label: «новая» | «как новая» | пусто; score: 1–10
  "defects": ["потёртость на правом кармане"],
  "deal": { "mode": "give" },        // give — отдаю; donate — донат от amount; price — фиксированная цена amount
  "market": 6000,                    // примерная стоимость на вторичном рынке, ₽
  "comment": "личный комментарий",
  "photos": [
    { "src": "images/coat-cos-001-1.jpg", "kind": "real" },   // real | model | ai | defect
    { "src": "images/coat-cos-001-defect.jpg", "kind": "defect" }
  ],
  "added": "2026-10-07",
  "status": "available"              // available | reserved | archive (= «уже в других руках»)
}
```

Сортировка: новая → как новая → 10/10 → 9/10 → …; при равном состоянии выше та, что добавлена позже.

## Публикация

Settings → Pages → Deploy from a branch → `main` / `(root)`.
