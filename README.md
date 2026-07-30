# 🃏 Mateo

## 🎯 Objetivo

Acumular **la menor cantidad de puntos**. Todos empiezan en **0** y, al terminar cada ronda, suman puntos según las cartas que les quedan. **El primer jugador que llega a 100 puntos pierde**; gana quien tenga el total más bajo en ese momento. Los puntos se acumulan a lo largo de toda la partida (no se reinician entre rondas).

**Valor de las cartas:** A=1, de 2 a 10 su número, J=11, Q=12, K=13. La **Q♥** es comodín y vale **0**.

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

## 📣 Declarar Mateo

Solo durante tu turno. Cantar **¡Mateo!** **termina la ronda al instante**, incluso si hay empate. Al terminar, cada jugador suma puntos a su total:

- **El que canta Mateo**: si tiene la **suma de cartas más baja** (sin empate), **gana** la ronda y suma **0 puntos**. Si **no** gana (empate o no es el más bajo), suma **el valor de sus cartas + 15** de penitencia.
- **Los demás jugadores**: suman **el valor de sus cartas**.
- **Quedarte sin cartas** (quemas/tríos) vale **−10 puntos** y también termina la ronda.
- Si el **mazo se agota** por completo, la ronda termina y cada quien suma el valor de sus cartas.

Tras revelar las cartas, cada jugador pulsa **CONTINUAR** cuando quiera (sin límite de tiempo) para ver la tabla de puntajes.
