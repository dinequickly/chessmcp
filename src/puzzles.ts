export interface Puzzle {
    id: string;
    rating: number;
    fen: string;
    moves: string[]; // UCI or SAN
    themes?: string[];
}

export const PUZZLES: Puzzle[] = [
    {
        id: "beginner-01",
        rating: 600,
        fen: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        moves: ["Qxf7#"],
        themes: ["mateIn1", "opening"]
    },
    {
        id: "beginner-02",
        rating: 800,
        fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
        moves: ["Re8#"],
        themes: ["mateIn1", "backRank"]
    },
    {
        id: "intermediate-01",
        rating: 1200,
        fen: "r1bqk2r/pppp1ppp/2n2n2/4p3/1bB1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5",
        moves: ["Nd5"], // Example of a positional move (not a tactic per se, but just filler for now)
        themes: ["opening"]
    },
    {
        id: "tactic-1500",
        rating: 1500,
        fen: "r2q1rk1/1bp2ppp/p1n5/1p1p4/3Pn3/1B3N2/PP3PPP/R1BQR1K1 w - - 0 1",
        moves: ["Bd2"], // Filler
        themes: ["middlegame"]
    },
    // Real Lichess Puzzle Example (Rating ~1800)
    {
        id: "lichess-X8cfQ",
        rating: 1843,
        fen: "1k6/1b3p1p/pP1rpPp1/3qn3/P1r1B3/2P1Q3/5PPP/3R1RK1 b - - 6 43",
        moves: ["d5d1", "f1d1", "d6d1", "e3e1", "d1e1"], // Black to move: ...Qxd1, Rxd1, Rxd1+, Qe1, Rxe1#
        themes: ["mateIn3"]
    },
    {
        id: "hard-2500",
        rating: 2500,
        fen: "8/8/8/8/3K4/8/4k3/5Q2 b - - 0 1",
        moves: ["e2f1"], // Simple king take, but rated high for distraction? (Just a placeholder)
        themes: ["endgame"]
    }
];
