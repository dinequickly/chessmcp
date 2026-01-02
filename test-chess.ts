
import { Chess } from "chess.js";

try {
    const c = new Chess();
    console.log("Chess created successfully");
    console.log(c.fen());
} catch (e) {
    console.error("Error creating chess:", e);
}
