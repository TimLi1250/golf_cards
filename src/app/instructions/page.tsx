import Link from "next/link";

export default function InstructionsPage() {
  return (
    <main className="instructions-page">
      <header className="instructions-header"><Link href="/" className="pixel-logo">GOLF</Link><Link href="/" className="back-link">← LOBBY</Link></header>
      <article className="instructions-card">
        <p>RULEBOOK v1.0</p><h1>HOW TO PLAY GOLF</h1>
        <section><b>01 / SET UP</b><h2>Four cards. Keep them secret.</h2><p>Every player is dealt four face-down cards in a square. Privately peek at your two nearest cards once, then remember what you saw.</p></section>
        <section><b>02 / YOUR TURN</b><h2>Draw, replace, or discard.</h2><p>Draw from the stock or take the top discard. A stock card may be discarded; a card taken from the discard pile must replace one of your four cards.</p></section>
        <section><b>03 / POWER CARDS</b><h2>Use the card you just placed down.</h2><p>Place down an 8 to swap any two face-down cards, or decline the swap. A Jack lets you privately see one of your own cards. A Queen lets you privately see one card belonging to anyone at the table.</p></section>
        <section><b>04 / MATCH THE DISCARD</b><h2>Call a matching card at any time.</h2><p>If one of your cards matches the rank on top of the discard, play it to lose that card. You can call another player&apos;s matching card too, then give that player one of your own cards. A wrong call knocks you out; everyone else keeps playing. If one player remains, they win the hole and a new hole begins.</p></section>
        <section><b>05 / KNOCK</b><h2>Call the final round.</h2><p>When you think your score is low, knock instead of drawing. Every other player takes one last normal turn before cards are revealed.</p></section>
        <section><b>06 / SCORE</b><h2>Win holes, earn points.</h2><p>Use card values to find the lowest layout: Ace is 1, number cards are face value, Jacks are 11, Queens are 12, Kings are 13, and Jokers are −2. The lowest layout wins the hole and earns 1 point; everyone else earns 0. Tied players each draw a card until one has the highest card. Most hole wins after nine holes wins the game.</p></section>
        <footer><strong>2–6 PLAYERS: ONE DECK</strong><strong>7–12 PLAYERS: TWO DECKS</strong></footer>
      </article>
    </main>
  );
}
