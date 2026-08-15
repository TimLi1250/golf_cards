import Link from "next/link";

export default function InstructionsPage() {
  return (
    <main className="instructions-page">
      <header className="instructions-header"><Link href="/" className="pixel-logo">FAIRWAY<span>_</span></Link><Link href="/" className="back-link">← LOBBY</Link></header>
      <article className="instructions-card">
        <p>RULEBOOK v1.0</p><h1>HOW TO PLAY GOLF</h1>
        <section><b>01 / SET UP</b><h2>Four cards. Keep them secret.</h2><p>Every player is dealt four face-down cards in a square. Privately peek at your two nearest cards once, then remember what you saw.</p></section>
        <section><b>02 / YOUR TURN</b><h2>Draw, replace, or discard.</h2><p>Draw from the stock or take the top discard. A stock card may be discarded; a card taken from the discard pile must replace one of your four cards.</p></section>
        <section><b>03 / KNOCK</b><h2>Call the final round.</h2><p>When you think your score is low, knock instead of drawing. Every other player takes one last normal turn before cards are revealed.</p></section>
        <section><b>04 / SCORE</b><h2>Low score wins the hole.</h2><p>Aces score 1, number cards score face value, Jacks and Queens score 10, and Kings score 0. Lowest total after nine holes wins.</p></section>
        <footer><strong>2–6 PLAYERS: ONE DECK</strong><strong>7–12 PLAYERS: TWO DECKS</strong></footer>
      </article>
    </main>
  );
}
