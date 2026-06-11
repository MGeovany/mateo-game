# 🃏 Mateo — Juego de Cartas Retro Multijugador

Juego web del clásico argentino **Mateo**: memoria, estrategia y agilidad mental. **Multijugador online en tiempo real** (2–4 jugadores, cada uno desde su dispositivo), con UI estilo retro arcade, sonidos generados con Web Audio y animaciones CSS.

**▶ Jugar:** https://mgeovany.github.io/mateo-game/

## 🌐 Multijugador

- Un jugador pulsa **CREAR PARTIDA** y obtiene un **código de sala de 4 caracteres**.
- Los demás entran con **UNIRSE** usando ese código.
- Cada jugador **solo ve sus propias cartas** — el anfitrión actúa como servidor autoritativo y envía a cada dispositivo un estado censurado.
- Conexión P2P vía WebRTC ([PeerJS](https://peerjs.com/)) — no requiere backend propio, funciona desde GitHub Pages.

## 🎮 Cómo se juega

- Cada jugador recibe **4 cartas boca abajo**. Al inicio toca **2 cartas para verlas y memorizarlas**, luego pulsa **CONFIRMAR**. Cuando todos confirman, comienza el juego.
- Los jugadores están sentados en círculo (tú siempre abajo); el banner indica de quién es el turno y solo ese jugador puede actuar.

### En tu turno

1. **Robar del mazo** (o tomar la carta del descarte) y decidir:
   - **⇄ Cambiar**: intercámbiala por una de tus cartas (vista o no). La reemplazada queda boca arriba en el centro.
   - **↓ Descartar**: suéltala directo al centro.
   - **★ Usar poder** (si es 7, 8 o 9).
   - **♦♦♦ Combinar trío**: si recuerdas tener un par del mismo valor que la carta robada, descarta las tres juntas. Si fallas: +1 carta de castigo.
2. **📣 ¡MATEO!**: declara si crees tener menos cartas que todos.

### 🔥 Quemar

Cualquier jugador puede intentar **quemar** la carta del descarte si recuerda tener una del mismo número — desde su propio dispositivo, en cualquier momento del turno. Si acierta, se deshace de ella. Si falla: recupera su carta **y roba una más de castigo**.

### Cartas especiales

| Carta | Efecto |
|---|---|
| **Q♥** | Comodín absoluto: vale **0** |
| **7** | Ver una de tus cartas (solo tú la ves) |
| **8** | Ver una carta de otro jugador (solo tú la ves) |
| **9** | Intercambiar una carta tuya con otro jugador, sin verlas |

### 📣 Gritar Mateo

Al declarar, todos revelan sus cartas:

- Si tenías **menos cartas** que los demás: ✅ no sumas puntos.
- Si no: ❌ **+15 puntos** más el valor de tus cartas restantes.
- Los demás suman el valor de sus cartas al marcador.

### 🎯 Final

El juego continúa en rondas. **Pierde** el primero en llegar a **100 puntos**. **Gana** quien tenga el menor puntaje.

## 🛠 Stack

- HTML + CSS + JavaScript vanilla, sin build ni frameworks.
- Multijugador WebRTC con PeerJS (host autoritativo, estado censurado por jugador).
- Sonidos sintetizados en tiempo real con **Web Audio API** (sin archivos de audio).
- Animaciones CSS (reparto, flip 3D, quemado, shake, glow neón) y estética CRT con scanlines.

## 🚀 Desarrollo

```bash
pnpm i
pnpm dev          # sirve en http://localhost:5173
pnpm test:engine  # smoke test del motor de juego (Node)
pnpm test:e2e     # e2e multijugador con 2 navegadores headless (requiere Chrome)
```

## Estructura

```
index.html      # pantallas: lobby, sala de espera, mesa, puntajes
css/style.css   # tema retro neón + animaciones
js/cards.js     # mazo y valores (Q♥ = 0)
js/game.js      # máquina de estados del juego (corre en el host)
js/host.js      # autoridad: valida acciones y censura el estado por jugador
js/net.js       # capa P2P (PeerJS)
js/ui.js        # render por dispositivo, interacciones, sonidos
js/audio.js     # efectos de sonido Web Audio
test/           # tests de motor y e2e
```
