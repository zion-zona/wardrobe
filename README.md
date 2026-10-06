# wardrobe

Сайт-шкаф: одежда, обувь, сумки и аксессуары на раздачу, обмен, донат или продажу.
Статический сайт для GitHub Pages: без сервера и базы данных.

## Как устроено

| Файл | Что внутри |
|---|---|
| `config.js` | Название, правила, контакт для заявок, место передачи |
| `data/items.json` | Список вещей |
| `images/` | Фото вещей |
| `index.html`, `assets/` | Код сайта |

Лайки и корзина хранятся в браузере каждого посетителя. Заявка — готовый текст,
который человек копирует и отправляет хозяйке шкафа (кнопка открывает Telegram,
если в `config.js` указан ник).

## Формат вещи (`data/items.json`)

```json
{
  "id": "005",
  "title": "Название",
  "category": "clothes | shoes | bags | accessories",
  "type": "Платье",
  "brand": "",
  "size": "M",
  "measurements": { "ПОГ": "46 см", "Длина": "90 см" },
  "color": "",
  "season": "",
  "condition": "new_tag | new | excellent | good | fair",
  "defects": ["описание дефекта"],
  "deal": ["gift", "swap", "donate", "price"],
  "price": 1500,
  "status": "available | reserved | given",
  "photos": ["images/005-1.jpg", "images/005-defect.jpg"],
  "description": "",
  "added": "2026-10-06"
}
```

Пустые поля на сайте не показываются.

## Публикация

Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`.
