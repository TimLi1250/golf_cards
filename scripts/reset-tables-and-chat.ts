import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.env.FAIRWAY_FOUR_DB_PATH || "data/fairway-four.sqlite");
if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);

const database = new DatabaseSync(databasePath);
try {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const backupPath = `${databasePath}.before-reset-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
  database.prepare("VACUUM INTO ?").run(backupPath);
  console.log(`Database backup: ${backupPath}`);

  database.exec("BEGIN IMMEDIATE");
  try {
    const hasChat = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'").get();
    const deletedMessages = hasChat ? database.prepare("DELETE FROM chat_messages").run().changes : 0;
    // Foreign-key cascades also remove the tables' seats and saved games.
    const rooms = database.prepare("DELETE FROM rooms").run();
    database.exec("COMMIT");
    console.log(`Cleared ${rooms.changes} tables and ${deletedMessages} chat messages. Player profiles were preserved.`);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
} finally {
  database.close();
}
