# 🃏 Mateo — Juego de Cartas Retro Multijugador

El clásico argentino **Mateo** en la web: memoria, estrategia y agilidad. Multijugador online en tiempo real (2–4 jugadores, cada uno desde su dispositivo y red), estética retro arcade, sonidos Web Audio y animaciones CSS. También hay modo **vs CPU** (fácil / medio / difícil).

**▶ Jugar:** https://mgeovany.github.io/mateo-game/

## 🌐 Multijugador

Un jugador **CREA** la sala y obtiene un **código de 4 caracteres**; los demás **se unen** con ese código desde cualquier red. El servidor es la única autoridad: valida cada acción y manda a cada dispositivo un estado censurado (solo ves tus cartas). Si te cae la conexión, vuelve a entrar con el **mismo nombre + código** y recuperas tu asiento. Las salas viven en RAM (un reinicio del server las borra).

## 🎯 Objetivo y cartas

Acumular **la menor cantidad de puntos**. Al final de cada ronda sumás el valor de tus cartas a tu total (los totales se arrastran). **El primero que llega a 100 pierde**; gana el total más bajo.

**Valores:** A=1, 2–10 su número, J=11, Q=12, K=13. La **Q♥** es comodín y vale **0**.

## 🎮 Cómo se juega

- Recibís **4 cartas boca abajo**; al inicio ves **2** y memorizás → **CONFIRMAR**.
- En tu turno **robás del mazo** (o **tomás la del centro**) y elegís:
  - **⇄ Cambiar** por una de tus cartas · **↓ Descartar** · **★ Usar poder** (7/8/9) · **♦♦♦ Combinar trío** (si recordás un par del valor robado; si fallás, +1 carta).
- **🔥 Quemar:** cuando una carta queda boca arriba, el primero que recuerde tener una del mismo valor puede quemarla (ambas salen del juego). Si falla: recupera su carta +1 de castigo. Sin quemado en cadena.

| Carta | Poder |
|---|---|
| **7** | Ves una carta tuya |
| **8** | Ves una carta de otro jugador |
| **9** | Intercambias a ciegas una carta tuya con otro jugador |

## 📣 Declarar Mateo

Solo en tu turno. Cantar **¡Mateo!** termina la ronda al instante. Si tenés la **suma más baja sin empate**, ganás la ronda (**0 puntos**); si no, sumás **tus cartas + 15**. Los demás suman el valor de sus cartas. **Quedarte sin cartas** = **−10** y termina la ronda; si se agota el mazo, cada quien suma sus cartas.

## 🪙 Monedas y tienda

Ganás monedas (guardadas localmente) por compartir invitación (+15), ronda ganada (+20) y partida ganada (+50). En la **🛒 TIENDA** canjeás avatares/sombreros/caras/zapatos, **bailes** y **estilos de mesa y cartas** (la mesa la viste el anfitrión).

## 🛠 Stack y deploy

- **Frontend:** HTML + CSS + JS vanilla (sin build) en **GitHub Pages** (rama `main`).
- **Backend:** **Node + Socket.IO** (salas en memoria, autoritativo, reconexión por nombre) en **Oracle Cloud Always Free**, systemd + **Caddy** para HTTPS/WSS en `143-47-100-210.sslip.io`.
- Sonidos sintetizados con **Web Audio** (sin archivos); animaciones CSS + estética CRT.
- Actualizar server: `ssh -i ~/.oci/mateo-instance-key ubuntu@143.47.100.210 "cd /opt/mateo && git pull && sudo systemctl restart mateo"`

## 🚀 Desarrollo

```bash
pnpm i             # incluye deps del servidor
pnpm dev:server    # salas en http://localhost:4377
pnpm dev           # frontend en http://localhost:5173
pnpm test:engine   # smoke test del motor
pnpm test:e2e      # e2e con 2 navegadores headless (requiere Chrome)
```

## Estructura

```
index.html · css/style.css        # pantallas + tema retro
js/net.js · ui.js · cards.js · audio.js   # cliente, render, cartas, sonido
server/index.js · room.js · game.js       # server, autoridad/reconexión, motor
test/                              # tests de motor y e2e
```
