# tma-portal

tma-portal — TM ANTOINE Advisory application based on the [Portal Design](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design) Figma file.

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

## Next steps

1. Scaffold Laravel (`composer create-project laravel/laravel .`)
2. Add Inter font and CSS variables from `design/tokens.json`
3. Pick a screen from `design/screens.json` and implement via Figma MCP `get_design_context`
4. Export illustrations to `public/images/illustrations/` using MCP `download_assets`
