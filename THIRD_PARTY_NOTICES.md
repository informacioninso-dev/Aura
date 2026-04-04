# Third-Party Notices

Last updated: 2026-04-04

This project uses third-party open source software. This file is a practical notice
for tracking direct dependencies and their licenses. It is not legal advice.

## General notes

- Most direct dependencies used by Aura are under permissive licenses such as `MIT`,
  `BSD`, `ISC`, or dual permissive licenses like `Apache-2.0 OR BSD-3-Clause`.
- These licenses usually allow commercial use, modification, and private deployment,
  subject to preserving the original copyright and license notices.
- This notice covers the main direct application dependencies reviewed in this repo.
- Static assets, logos, fonts, images, example data, and third-party content should be
  reviewed separately because they may have different terms than the code libraries.

## Special note: psycopg2-binary

Aura currently includes `psycopg2-binary`, which is published as `LGPL with exceptions`.
For typical SaaS use, where Aura is hosted and not distributed to customers as software,
the practical risk is lower than in on-premise redistribution scenarios.

If Aura is later distributed to customers as a packaged product, appliance, Docker image,
desktop app, or other redistributable software, this dependency deserves a focused legal
review. In that case, consider evaluating a switch to a PostgreSQL adapter strategy with
clearer distribution posture for your business model.

## Frontend runtime dependencies

| Package | Version | License |
| --- | --- | --- |
| `@headlessui/react` | `2.2.9` | `MIT` |
| `axios` | `1.13.6` | `MIT` |
| `lucide-react` | `1.7.0` | `ISC` |
| `react` | `19.2.4` | `MIT` |
| `react-dom` | `19.2.4` | `MIT` |
| `react-hook-form` | `7.72.0` | `MIT` |
| `react-router-dom` | `7.13.2` | `MIT` |
| `recharts` | `3.8.1` | `MIT` |

## Frontend development dependencies

| Package | Version | License |
| --- | --- | --- |
| `@eslint/js` | `9.39.4` | `MIT` |
| `@tailwindcss/vite` | `4.2.2` | `MIT` |
| `@types/react` | `19.2.14` | `MIT` |
| `@types/react-dom` | `19.2.3` | `MIT` |
| `@vitejs/plugin-react` | `6.0.1` | `MIT` |
| `eslint` | `9.39.4` | `MIT` |
| `eslint-plugin-react-hooks` | `7.0.1` | `MIT` |
| `eslint-plugin-react-refresh` | `0.5.2` | `MIT` |
| `globals` | `17.4.0` | `MIT` |
| `tailwindcss` | `4.2.2` | `MIT` |
| `vite` | `8.0.3` | `MIT` |

## Backend runtime dependencies

| Package | Version | License / note |
| --- | --- | --- |
| `Django` | `6.0.3` | `BSD-3-Clause` |
| `Pillow` | `12.1.1` | `MIT-CMU` |
| `djangorestframework` | `3.17.1` | `BSD-3-Clause` |
| `djangorestframework-simplejwt` | `5.5.1` | `MIT` |
| `django-cors-headers` | `4.9.0` | `MIT` |
| `cryptography` | `46.0.6` | `Apache-2.0 OR BSD-3-Clause` |
| `gunicorn` | `25.3.0` | `MIT` |
| `psycopg2-binary` | `2.9.11` | `LGPL with exceptions` |
| `openpyxl` | `3.1.5` | `MIT` |
| `reportlab` | `4.4.10` | `BSD` |

## Operational guidance

- Preserve upstream license texts when required by the dependency license.
- Keep this file updated when adding or replacing dependencies.
- If Aura is sold as hosted SaaS only, the current dependency set is generally aligned
  with normal commercial use.
- If Aura is redistributed as software, run a deeper legal review before shipping.
