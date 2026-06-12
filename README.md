# 🃏 Mateo — Juego de Cartas Retro Multijugador

Juego web del clásico argentino **Mateo**: memoria, estrategia y agilidad mental. **Multijugador online en tiempo real** (2–4 jugadores, cada uno desde su dispositivo), con UI estilo retro arcade, sonidos generados con Web Audio y animaciones CSS.

**▶ Jugar:** https://mgeovany.github.io/mateo-game/

## 🌐 Multijugador

- Un jugador pulsa **CREAR PARTIDA** y obtiene un **código de sala de 4 caracteres**.
- Los demás entran con **UNIRSE** usando ese código — **desde cualquier red**, no hace falta estar en el mismo WiFi.
- Cada jugador **solo ve sus propias cartas** — el servidor es la única autoridad: valida cada acción y envía a cada dispositivo un estado censurado. El cliente nunca decide resultados.
- **Reconexión**: las caídas breves se reconectan solas; si cierras la página, vuelve a entrar con el **mismo nombre** y código — tu asiento y tus cartas te esperan. La partida ya no depende del celular del anfitrión.
- Las salas viven en la memoria RAM del servidor (sin persistencia): un reinicio del servidor las borra.

## 🎯 Objetivo

Ser el primer jugador en conseguir **⭐⭐⭐ 3 estrellas**. Una estrella se obtiene al declarar correctamente **"Mateo"**. Las estrellas pertenecen a la partida completa y no se reinician entre rondas.

## 🎮 Flujo base

- Cada jugador recibe **4 cartas boca abajo**. Al inicio toca **2 para verlas y memorizarlas**, luego pulsa **CONFIRMAR**.
- En tu turno robas una carta y decides:
  - **⇄ Cambiar**: intercámbiala por una de tus cartas (vista o no). La reemplazada queda boca arriba en el centro.
  - **↓ Descartar**: suéltala directo al centro.
  - **★ Usar poder** (si es 7, 8 o 9).
  - **♦♦♦ Combinar trío**: si recuerdas tener un par del mismo valor que la robada, descarta las tres juntas de inmediato. Si fallas: +1 carta de castigo.
- El juego continúa en sentido horario.

## 🔥 Quemar y prioridad de acciones

Cuando una carta queda boca arriba en el descarte:

1. **Cualquier jugador** puede intentar quemarla si recuerda tener una del mismo valor. **Solo el primero** que reclame la quema la intenta (el servidor host decide quién llegó primero).
2. Si acierta: su carta y la descartada **desaparecen del juego** (no vuelven al mazo), nadie más puede quemarla y **el siguiente jugador pierde el derecho a tomarla**.
3. Si falla: recupera su carta **y roba una de castigo** (puede quedar con 5+ cartas).
4. Si nadie la quema, **solo el jugador inmediatamente siguiente** puede tomarla.

La carta tomable/quemable brilla en amarillo; una carta ya superada se ve apagada y no se puede tocar.

## ✨ Cartas especiales

| Carta | Efecto |
|---|---|
| **Q♥** | Comodín (valor 0) |
| **7** | Ver una de tus cartas (solo tú la ves) |
| **8** | Ver una carta de otro jugador (solo tú la ves) |
| **9** | Intercambiar una carta tuya con otro jugador, ambas boca abajo; solo tú sabes qué posición intercambiaste |

## 📣 Declarar Mateo

Solo durante tu turno. Se comparan las **cantidades** de cartas:

- **Menos cartas que todos** → ganas la ronda y **+1 ⭐**.
- **Empate** en el mínimo → nadie gana estrella y la ronda continúa.
- **Alguien tiene menos** → pierdes 1 ⭐ (si tienes) y la ronda continúa.

Quedarte **sin cartas** (quemas/tríos) también gana la ronda. Si el mazo se agota por completo, la ronda termina sin estrella.

## 🛠 Stack

- Frontend: HTML + CSS + JavaScript vanilla, sin build ni frameworks — hospedado gratis en **GitHub Pages**.
- Backend: **Node + Socket.IO** (salas en memoria, servidor autoritativo, estado censurado por jugador, reconexión por nombre) — en **Oracle Cloud Always Free** (VM.Standard.E2.1.Micro, us-ashburn-2, HTTPS vía Caddy + sslip.io).
- Sonidos sintetizados en tiempo real con **Web Audio API** (sin archivos de audio).
- Animaciones CSS (reparto, flip 3D, quemado, shake, glow neón) y estética CRT con scanlines.

## ☁️ Deploy

- **Frontend**: GitHub Pages sirve este repo tal cual (rama `main`).
- **Backend**: Oracle Cloud Always Free — `VM.Standard.E2.1.Micro` (`mateo-server`, us-ashburn-2) corre `server/` como servicio systemd en el puerto 4377, con **Caddy** delante para HTTPS/WSS en `143-47-100-210.sslip.io`. Siempre encendido, $0/mes.
- Para actualizar el servidor: `ssh -i ~/.oci/mateo-instance-key ubuntu@143.47.100.210 "cd /opt/mateo && git pull && sudo systemctl restart mateo"`.

## 🚀 Desarrollo

```bash
pnpm i             # instala también las deps del servidor
pnpm dev:server    # servidor de salas en http://localhost:4377
pnpm dev           # frontend en http://localhost:5173 (apunta solo al server local)
pnpm test:engine   # smoke test del motor de juego (Node)
pnpm test:e2e      # e2e multijugador con 2 navegadores headless (requiere Chrome)
```

## Estructura

```
index.html        # pantallas: lobby, sala de espera, mesa, puntajes
css/style.css     # tema retro neón + animaciones
js/net.js         # cliente Socket.IO (crear/unirse, auto-rejoin)
js/ui.js          # render por dispositivo, interacciones, sonidos
js/cards.js       # helpers de render de cartas
js/audio.js       # efectos de sonido Web Audio
server/index.js   # servidor de salas (Socket.IO)
server/room.js    # autoridad: valida acciones, censura estado, reconexión
server/game.js    # máquina de estados del juego (una instancia por sala)
test/             # tests de motor y e2e
```
