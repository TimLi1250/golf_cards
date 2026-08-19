# Golf

An online, real-time version of Four Card Golf for 2–12 players. Create a public or private table, invite friends, play nine rounds, chat at the table, and install it as a mobile web app.

## Features

- Public and private game tables with shareable invite links and codes
- Realtime room updates, player presence, and lobby/table chat
- 2–12 players; a second deck is automatically used for more than six players
- Four-card hands, initial peek, stock and discard piles, knocking, matching, and power cards
- 8: swap two cards; Jack: view one of your own cards; Queen: view any card
- Jokers are worth `-2`; Ace is `1`; number and face cards score `2–13`
- Nine-hole score tracking, tie-break cards, replacement/match animations, BGM, and button sound effects
- Responsive layout and PWA support for phone installation

## Requirements

- Node.js 20 or newer
- npm

## Run locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The game stores its local SQLite database in `data/fairway-four.sqlite` by default. This is development data and is ignored by Git.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js and Socket.IO development server |
| `npm run build` | Create a production build |
| `npm start` | Run the production server after building |
| `npm run lint` | Run ESLint |
| `npm test` | Run the game and room tests |

## How to play

1. Create a table or join an existing public table. Private tables require the invite code.
2. Each player peeks at their two nearest cards before the first turn.
3. On a turn, draw from stock or take the discard, then replace one of your cards or discard a stock draw.
4. Match a face-down card to the top discard at any time. A correct own match removes that card; a wrong match eliminates the caller for that hole.
5. Calling another player’s matching card correctly removes their card, then requires you to give them one of yours. A wrong call eliminates you for that hole.
6. Discarded or matched 8s, Jacks, and Queens grant their powers in order. Matched power cards are resolved after the action already in progress.
7. Knock when you are ready to end the hole. Each other active player takes one final turn, then the table gets a short final matching window.
8. At the end of a hole, every hand is revealed. The winner earns one point. After nine holes, the player with the most wins takes the game.

If you have no cards left and draw from stock, you may discard it or keep it—useful when it might be a Joker.

## Deployment

This application uses Socket.IO and SQLite, so it should run as one Node process with persistent storage. It is not designed for horizontally scaled, serverless deployments.

For the Oracle Cloud + Docker + Caddy setup used by this project, see [OCI_DEPLOYMENT.md](OCI_DEPLOYMENT.md). General Docker and Render notes are in [DEPLOYMENT.md](DEPLOYMENT.md).

The included `docker-compose.oci.yml` runs:

- the game server with its SQLite database mounted at `/data`;
- Caddy as the HTTPS reverse proxy.

After updating a deployed Git repository, the typical server workflow is:

```bash
git pull --ff-only
docker compose -f docker-compose.oci.yml up -d --build
```

On small Oracle Free Tier instances, make sure swap is enabled before a Docker build; Next.js builds can briefly require more memory than a 1 GB VM has available.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port |
| `FAIRWAY_FOUR_DB_PATH` | `data/fairway-four.sqlite` | SQLite database file location |

## Project structure

| Path | Description |
| --- | --- |
| `src/app` | Next.js pages and API routes |
| `src/lib/golf` | Authoritative card-game rules and protocol types |
| `src/lib/rooms` | SQLite-backed tables, players, game state, and chat storage |
| `src/lib/realtime` | Socket.IO event and presence helpers |
| `src/components` | Reusable UI, audio, and chat components |
| `server.ts` | Custom Next.js + Socket.IO server |

## License

This project is private and has no license assigned yet.
