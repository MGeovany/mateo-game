# 🃏 Mateo — Juego de Cartas Retro

MVP web del juego de cartas argentino **Mateo**: memoria, estrategia y agilidad mental. 4 jugadores en la misma pantalla (hot-seat), con UI estilo retro arcade, sonidos generados con Web Audio y animaciones CSS.

**▶ Jugar:** https://mgeovany.github.io/mateo-game/

## 🎮 Cómo se juega

- 4 jugadores reciben **4 cartas boca abajo**. Al inicio cada uno elige **2 cartas para ver y memorizar**, luego pulsa **LISTO**. Cuando todos están listos, comienza el juego.
- Los jugadores están sentados en círculo; el banner verde indica **de quién es el turno**.

### En tu turno

1. **Robar del mazo** (o tomar la carta del descarte) y decidir:
   - **⇄ Cambiar**: intercámbiala por una de tus cartas (vista o no). La reemplazada queda boca arriba en el centro.
   - **↓ Descartar**: suéltala directo al centro.
   - **★ Usar poder** (si es 7, 8 o 9).
   - **♦♦♦ Combinar trío**: si recuerdas tener un par del mismo valor que la carta robada, descarta las tres juntas. Si fallas: +1 carta de castigo.
2. **📣 ¡MATEO!**: declara si crees tener menos cartas que todos.

### 🔥 Quemar

Cualquier jugador puede intentar **quemar** la carta del descarte si recuerda tener una del mismo número. Si acierta, se deshace de ella. Si falla: recupera su carta **y roba una más de castigo**.

### Cartas especiales

| Carta | Efecto |
|---|---|
| **Q♥** | Comodín absoluto: vale **0** |
| **7** | Ver una de tus cartas |
| **8** | Ver una carta de otro jugador |
| **9** | Intercambiar una carta tuya con otro jugador, sin verlas |

### 📣 Gritar Mateo

Al declarar, todos revelan sus cartas:

- Si tenías **menos cartas** que los demás: ✅ no sumas puntos.
- Si no: ❌ **+15 puntos** más el valor de tus cartas restantes.
- Los demás suman el valor de sus cartas al marcador.

### 🎯 Final

El juego continúa en rondas. **Pierde** el primero en llegar a **100 puntos**. **Gana** quien tenga el menor puntaje.

## 🛠 Stack

- HTML + CSS + JavaScript vanilla, sin dependencias ni build.
- Sonidos sintetizados en tiempo real con **Web Audio API** (sin archivos de audio).
- Animaciones CSS (reparto, flip 3D, quemado, shake, glow neón) y estética CRT con scanlines.

## 🚀 Correr local

```bash
# cualquier servidor estático sirve
npx serve .
# o simplemente abrir index.html en el navegador
```

## Estructura

```
index.html      # pantallas: lobby, mesa, puntajes
css/style.css   # tema retro neón + animaciones
js/cards.js     # mazo, valores (Q♥ = 0)
js/game.js      # máquina de estados del juego
js/ui.js        # render, interacciones, animaciones
js/audio.js     # efectos de sonido Web Audio
```
