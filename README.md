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

Acumular **la menor cantidad de puntos**. Todos empiezan en **0** y, al terminar cada ronda, suman puntos según las cartas que les quedan. **El primer jugador que llega a 100 puntos pierde**; gana quien tenga el total más bajo en ese momento. Los puntos se acumulan a lo largo de toda la partida (no se reinician entre rondas).

**Valor de las cartas:** A=1, 2–10 su número, J=11, Q=12, K=13. La **Q♥** es comodín y vale **0**.

## 🎮 Flujo base

- Cada jugador recibe **4 cartas boca abajo**. Al inicio toca **2 para verlas y memorizarlas**, luego pulsa **CONFIRMAR**.
- En tu turno robas una carta y decides:
  - **⇄ Cambiar**: intercámbiala por una de tus cartas (vista o no). La reemplazada queda boca arriba en el centro.
  - **↓ Descartar**: suéltala directo al centro.
  - **★ Usar poder** (si es 7, 8 o 9).
  - **♦♦♦ Combinar trío**: si recuerdas tener un par del mismo valor que la robada, descarta las tres juntas de inmediato. Si fallas: +1 carta de castigo.
- También puedes **⬆ tomar la carta superior del centro** (el descarte) en lugar de robar del mazo.
- El juego continúa en sentido horario.

## 🔥 Quemar y prioridad de acciones

Cuando una carta queda boca arriba en el descarte:

1. **Cualquier jugador** puede intentar quemarla si recuerda tener una del mismo valor. **Solo el primero** que reclame la quema la intenta (el servidor host decide quién llegó primero).
2. Si acierta: su carta y la descartada **desaparecen del juego** (no vuelven al mazo). **Una vez quemada, nadie puede volver a quemar esa carta** (no hay quemado en cadena): solo un nuevo descarte crea otro objetivo quemable.
3. Si falla: recupera su carta **y roba una de castigo** (puede quedar con 5+ cartas).
4. En tu turno también puedes **tomar la carta superior del descarte** (el centro) en lugar de robar del mazo.

La carta recién descartada (quemable) brilla en amarillo; una carta ya superada se ve apagada.

## ✨ Cartas especiales

| Carta | Efecto |
|---|---|
| **Q♥** | Comodín (valor 0) |
| **7** | Ver una de tus cartas (solo tú la ves) |
| **8** | Ver una carta de otro jugador (solo tú la ves) |
| **9** | Intercambiar una carta tuya con otro jugador, ambas boca abajo; solo tú sabes qué posición intercambiaste |

## 🪙 Monedas y tienda

Cada dispositivo acumula monedas (guardadas localmente):

| Acción | Recompensa |
|---|---|
| Compartir el enlace de invitación (1 vez por sala) | +10 🪙 |
| Ronda ganada (terminas con 0 o menos puntos) | +10 🪙 |
| Ganar la partida (total más bajo al llegar alguien a 100) | +30 🪙 |

En la **🛒 TIENDA** (desde el lobby) canjeas monedas por:

- **Avatares, sombreros, caras y zapatos** — los demás jugadores ven tu combinación en la sala y en la mesa.
- **Bailes** — un botón `BAILAR` durante la partida muestra tu baile sobre tu asiento a toda la mesa (cooldown 8s).
- **Estilos de mesa y de cartas** — la mesa es del anfitrión: su estilo de mesa y dorso de cartas visten la sala para todos.

## 📣 Declarar Mateo

Solo durante tu turno. Cantar **¡Mateo!** **termina la ronda al instante**, incluso si hay empate. Al terminar, cada jugador suma puntos a su total:

- **El que canta Mateo**: si tiene la **suma de cartas más baja** (sin empate), **gana** la ronda y suma **0 puntos**. Si **no** gana (empate o no es el más bajo), suma **el valor de sus cartas + 15** de penitencia.
- **Los demás jugadores**: suman **el valor de sus cartas**.
- **Quedarte sin cartas** (quemas/tríos) vale **−10 puntos** y también termina la ronda.
- Si el **mazo se agota** por completo, la ronda termina y cada quien suma el valor de sus cartas.

Tras revelar las cartas, cada jugador pulsa **CONTINUAR** cuando quiera (sin límite de tiempo) para ver la tabla de puntajes.

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
