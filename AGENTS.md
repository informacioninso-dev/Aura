# Aura — Guía para agentes

Aura es una app de finanzas personales (en **español**). Monorepo:
- `back/` — API Django REST (Python).
- `front/` — web React + Vite (SPA; landing pública en `/`).
- `Aura_mobile/` — app Expo / React Native (**repo git propio anidado**; ver su `AGENTS.md`).

## 📌 Lo PRIMERO: leé y mantené `MEMORY.md`

**Al empezar a trabajar, leé [MEMORY.md](MEMORY.md).** Es la **memoria de largo plazo** del proyecto: arquitectura, decisiones, aprendizajes, gotchas y novedades. Vive en el repo, así que cualquier agente en cualquier máquina la tiene al día vía git (no depende de la memoria local de ningún agente).

**Mantenela actualizada — es parte del trabajo.** Cuando:
- tomes una **decisión** de arquitectura o producto,
- aprendas algo **no obvio** (un gotcha, una limitación, un "ojo con esto"),
- agregues o cambies una **feature destacada**,
- o descubras algo que el próximo agente debería saber para no tropezar,

→ actualizá `MEMORY.md` en la sección que corresponda **y** agregá un bullet con fecha en **"Novedades"**. Dejá el commit con el cambio **y** la memoria al día, juntos. Mantené `MEMORY.md` **curada y corta** (se lee cada sesión): señal alta, sin ruido.

## Convenciones
- **Commits SIN coautoría** — no agregar la línea `Co-Authored-By`.
- **El remoto es la fuente de verdad** — `git fetch`/pull antes de trabajar; se trabaja desde varias máquinas.
- Todo en **español** (UI, copys, mensajes de error, commits).
- **CSP estricto en prod**: cualquier recurso externo (fuentes, CDNs, scripts) se bloquea → **auto-hospedar siempre** (ver MEMORY.md).
- Deploy, entorno local, IA y demás aprendizajes → **MEMORY.md**.
