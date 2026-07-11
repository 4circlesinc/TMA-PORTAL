# tma-portal

tma-portal — TM ANTOINE Advisory application based on the [Portal Design](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design) Figma file.

## Stack

- **Laravel 13** (PHP 8.3+)
- **Blade** components in `resources/views/components/`
- **Support classes** in `app/Support/`
- Static assets in `public/`

## Local setup

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan serve
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Deploy to Laravel Cloud

1. Push this repo to GitHub, GitLab, or Bitbucket.
2. Create a new application at [cloud.laravel.com](https://cloud.laravel.com).
3. Connect the repository — Laravel Cloud auto-detects Laravel.
4. Set environment variables (minimum):
   - `APP_KEY` — run `php artisan key:generate --show` locally and paste the value
   - `APP_ENV=production`
   - `APP_DEBUG=false`
5. **Build command:** `composer install --no-dev --optimize-autoloader`
6. **Deploy command:** `php artisan migrate --force` (optional until you add migrations)
7. Deploy.

## Figma connection

Design reference is stored in `design/`:

| File | Purpose |
|------|---------|
| `design/figma.json` | File key, node IDs, MCP tool map |
| `design/tokens.json` | Colors, typography, spacing from Figma variables |
| `design/screens.json` | Desktop & mobile screen inventory |
| `design/illustrations.json` | Illustration catalog |
| `design/emoji.json` | Fluent Emoji catalog |
| `design/avatars.json` | Avatar asset catalog |
| `design/avatar-names.json` | Name → avatar mapping (user chips) |
| `design/avatar-usage.md` | Laravel Blade usage examples |

Connected via Figma MCP as **Vernon Francis** (`igraphixmarketingco@gmail.com`).

## Design system

- **tma-portal** — TM ANTOINE Advisory
- Primary font: **Inter**
- Dark UI with gradient headings and backdrop blur effects

## Project structure

```
app/Support/          # PHP helpers (Charts, Avatars, Cursors, etc.)
resources/views/      # Blade components and pages
public/               # CSS, JS, images, and legacy static HTML pages
design/               # Figma tokens and design metadata
```
