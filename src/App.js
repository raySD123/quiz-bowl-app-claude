import { useState, useEffect, useRef, useCallback } from "react";

// ── Constants ──────────────────────────────────────────────────────────────
const TOTAL_TIME = 30;
const POST_READ_TIME = 5;
const BUZZ_TIME = 9;
const SPEED_MAP = { 1: 80, 2: 55, 3: 38, 4: 22, 5: 12 };

// ── Helpers ────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const qi = headers.indexOf("question");
  const ai = headers.indexOf("answer");
  if (qi === -1 || ai === -1) return null;
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
      return {
        question: (cols[qi] || "").replace(/^"|"$/g, "").trim(),
        answer: (cols[ai] || "").replace(/^"|"$/g, "").trim(),
      };
    })
    .filter((q) => q.question && q.answer);
}

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function checkAnswer(user, correct) {
  const normUser = normalize(user);
  const normCorrect = normalize(correct);
  const rawCorrect = correct.toLowerCase();
  if (normUser === normCorrect || normUser === rawCorrect) return "exact";
  if (
    normCorrect.includes(normUser) ||
    normUser.includes(normCorrect) ||
    rawCorrect.includes(normUser) ||
    normUser.includes(rawCorrect)
  )
    return "substring";
  return "wrong";
}

// ── Timer bar component ────────────────────────────────────────────────────
function TimerBar({ value, max, color }) {
  const pct = Math.max(0, (value / max) * 100);
  return (
    <div style={{ height: 4, background: "#e5e7eb", borderRadius: 2, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: color,
          borderRadius: 2,
          transition: "width 0.1s linear, background 0.3s",
        }}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function QuizBowl() {
  const [screen, setScreen] = useState("upload"); // upload | game | done
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [speed, setSpeed] = useState(3);

  // Game state
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [buzzed, setBuzzed] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | typing | postread | answering | prompted | result
  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);
  const [buzzTimeLeft, setBuzzTimeLeft] = useState(BUZZ_TIME);
  const [postTimeLeft, setPostTimeLeft] = useState(POST_READ_TIME);
  const [status, setStatus] = useState({ text: "", type: "" }); // type: correct | wrong | neutral
  const [answerVal, setAnswerVal] = useState("");
  const [promptVal, setPromptVal] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [flagged, setFlagged] = useState([]); // { q, overridden }
  const [showNext, setShowNext] = useState(false);

  const answerRef = useRef(null);
  const promptRef = useRef(null);
  const typeRef = useRef(null);
  const timerRef = useRef(null);
  const postRef = useRef(null);
  const buzzRef = useRef(null);
  const charRef = useRef(0);

  // ── Clear all intervals ────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    clearInterval(typeRef.current);
    clearInterval(timerRef.current);
    clearInterval(postRef.current);
    clearInterval(buzzRef.current);
  }, []);

  // ── End question ──────────────────────────────────────────────────────
  const endQuestion = useCallback(
    (isCorrect, isTimeout, currentQ, currentFlagged) => {
      clearAll();
      setPhase("result");
      setShowNext(true);
      setDisplayed((prev) => prev); // keep displayed text

      if (isTimeout) {
        setStatus({ text: `Time's up! The answer was: ${currentQ.answer}`, type: "wrong" });
        setWrongCount((c) => c + 1);
      } else if (isCorrect) {
        setStatus({ text: "Correct!", type: "correct" });
        setCorrectCount((c) => c + 1);
      } else {
        setStatus({ text: `Incorrect. The answer was: ${currentQ.answer}`, type: "wrong" });
        setWrongCount((c) => c + 1);
      }
    },
    [clearAll]
  );

  // ── Start buzz timer ──────────────────────────────────────────────────
  const startBuzzTimer = useCallback(
    (currentQ, currentFlagged) => {
      let remaining = BUZZ_TIME;
      setBuzzTimeLeft(remaining);
      buzzRef.current = setInterval(() => {
        remaining--;
        setBuzzTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(buzzRef.current);
          setPhase("result");
          endQuestion(false, true, currentQ, currentFlagged);
        }
      }, 1000);
    },
    [endQuestion]
  );

  // ── CSV upload ────────────────────────────────────────────────────────
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      if (!parsed) {
        alert('CSV must have "question" and "answer" columns.');
        return;
      }
      setQuestions(shuffle(parsed));
      setScreen("game");
      resetState(0, [], 0, 0);
    };
    reader.readAsText(file);
  }

  // ── Reset state for a new question ───────────────────────────────────
  function resetState(newIndex, newFlagged, newCorrect, newWrong) {
    clearAll();
    charRef.current = 0;
    setQIndex(newIndex);
    setDisplayed("");
    setStarted(false);
    setFinished(false);
    setBuzzed(false);
    setPhase("idle");
    setTimeLeft(TOTAL_TIME);
    setBuzzTimeLeft(BUZZ_TIME);
    setPostTimeLeft(POST_READ_TIME);
    setStatus({ text: "", type: "" });
    setAnswerVal("");
    setPromptVal("");
    setShowNext(false);
    setFlagged(newFlagged);
    setCorrectCount(newCorrect);
    setWrongCount(newWrong);
  }

  // ── Start question ────────────────────────────────────────────────────
  function startQuestion() {
    if (started) return;
    setStarted(true);
    setPhase("typing");
    const q = questions[qIndex];

    // Typing interval
    typeRef.current = setInterval(() => {
      charRef.current += 1;
      const next = q.question.slice(0, charRef.current);
      setDisplayed(next);
      if (charRef.current >= q.question.length) {
        clearInterval(typeRef.current);
        setFinished(true);
        setPhase("postread");
        let remaining = POST_READ_TIME;
        setPostTimeLeft(remaining);
        postRef.current = setInterval(() => {
          remaining--;
          setPostTimeLeft(remaining);
          if (remaining <= 0) {
            clearInterval(postRef.current);
            endQuestion(false, true, q, flagged);
          }
        }, 1000);
      }
    }, SPEED_MAP[speed]);

    // Main timer
    let tLeft = TOTAL_TIME;
    timerRef.current = setInterval(() => {
      if (charRef.current >= q.question.length) return; // postread takes over
      tLeft--;
      setTimeLeft(tLeft);
      if (tLeft <= 0) {
        clearInterval(timerRef.current);
        endQuestion(false, true, q, flagged);
      }
    }, 1000);
  }

  // ── Buzz ──────────────────────────────────────────────────────────────
  function buzz() {
    if (buzzed || !started || phase === "result") return;
    clearAll();
    setBuzzed(true);
    setPhase("answering");
    setStatus({ text: "Buzzed in — type your answer and submit!", type: "neutral" });
    setTimeout(() => answerRef.current?.focus(), 50);
    startBuzzTimer(questions[qIndex], flagged);
  }

  // ── Submit answer ─────────────────────────────────────────────────────
  function submitAnswer() {
    if (!answerVal.trim()) return;
    clearInterval(buzzRef.current);
    const result = checkAnswer(answerVal.trim(), questions[qIndex].answer);
    setAnswerVal("");

    if (result === "exact") {
      endQuestion(true, false, questions[qIndex], flagged);
    } else if (result === "substring") {
      setPhase("prompted");
      setStatus({ text: "Prompt.", type: "neutral" });
      setTimeout(() => promptRef.current?.focus(), 50);
    } else {
      const newFlagged = [...flagged, { q: questions[qIndex], overridden: false }];
      setFlagged(newFlagged);
      endQuestion(false, false, questions[qIndex], newFlagged);
    }
  }

  // ── Submit prompt ─────────────────────────────────────────────────────
  function submitPrompt() {
    if (!promptVal.trim()) return;
    const result = checkAnswer(promptVal.trim(), questions[qIndex].answer);
    setPromptVal("");
    if (result === "exact") {
      endQuestion(true, false, questions[qIndex], flagged);
    } else {
      const newFlagged = [...flagged, { q: questions[qIndex], overridden: false }];
      setFlagged(newFlagged);
      endQuestion(false, false, questions[qIndex], newFlagged);
    }
  }

  // ── Next question ─────────────────────────────────────────────────────
  function nextQuestion() {
    const nextIndex = qIndex + 1;
    if (nextIndex >= questions.length) {
      setScreen("done");
    } else {
      resetState(nextIndex, flagged, correctCount, wrongCount);
    }
  }

  // ── Override toggle ───────────────────────────────────────────────────
  function toggleOverride(i) {
    setFlagged((prev) =>
      prev.map((item, idx) =>
        idx === i ? { ...item, overridden: !item.overridden } : item
      )
    );
  }

  // ── Restart ───────────────────────────────────────────────────────────
  function restartGame() {
    setQuestions((q) => shuffle(q));
    setScreen("game");
    resetState(0, [], 0, 0);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (started && !buzzed && phase !== "result") buzz();
      }
      if (e.key === "j" || e.key === "J") {
        if (showNext) nextQuestion();
        else if (!started && screen === "game") startQuestion();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [started, buzzed, phase, showNext, screen, qIndex, flagged, correctCount, wrongCount]);

  // ── Timer color ───────────────────────────────────────────────────────
  const timerColor =
    timeLeft <= 10 ? "#ef4444" : timeLeft <= 20 ? "#f59e0b" : "#10b981";
  const postColor = "#ef4444";
  const buzzColor = "#3b82f6";

  const adjustedScore =
    correctCount + flagged.filter((f) => f.overridden).length;

  // ── Styles ────────────────────────────────────────────────────────────
  const s = {
    wrap: {
      fontFamily: "'Georgia', serif",
      maxWidth: 680,
      margin: "0 auto",
      padding: "2rem 1.5rem",
      color: "#1a1a1a",
    },
    uploadBox: {
      border: "1.5px dashed #d1d5db",
      borderRadius: 12,
      padding: "3rem 2rem",
      textAlign: "center",
      background: "#fafafa",
    },
    uploadBtn: {
      background: "#1a1a1a",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      padding: "10px 24px",
      fontSize: 15,
      cursor: "pointer",
      marginBottom: 8,
    },
    uploadHint: { fontSize: 13, color: "#6b7280", marginTop: 8 },
    metaRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
      fontSize: 13,
      color: "#6b7280",
    },
    pills: { display: "flex", gap: 8 },
    pill: (type) => ({
      padding: "3px 10px",
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      border: "1px solid",
      ...(type === "correct"
        ? { background: "#ecfdf5", color: "#065f46", borderColor: "#6ee7b7" }
        : { background: "#fef2f2", color: "#7f1d1d", borderColor: "#fca5a5" }),
    }),
    speedRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
    speedLabel: { fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" },
    qBox: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      padding: "1.5rem",
      minHeight: 120,
      marginBottom: 16,
      fontSize: 17,
      lineHeight: 1.7,
    },
    timerLabel: { fontSize: 13, color: "#6b7280", marginBottom: 4 },
    timerWrap: { marginBottom: 20 },
    answerRow: { display: "flex", gap: 8, marginBottom: 16, alignItems: "center" },
    input: {
      flex: 1,
      padding: "9px 12px",
      border: "1px solid #d1d5db",
      borderRadius: 8,
      fontSize: 15,
      outline: "none",
    },
    promptLabel: {
      fontSize: 14,
      color: "#6b7280",
      fontStyle: "italic",
      marginBottom: 8,
    },
    controls: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
    startBtn: {
      background: "#1a1a1a",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      padding: "10px 20px",
      fontSize: 14,
      cursor: "pointer",
    },
    buzzBtn: (disabled) => ({
      background: disabled ? "#d1d5db" : "#10b981",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      padding: "10px 28px",
      fontSize: 15,
      fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
    }),
    submitBtn: {
      background: "#2563eb",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      padding: "10px 20px",
      fontSize: 14,
      cursor: "pointer",
    },
    nextBtn: {
      background: "#f3f4f6",
      border: "1px solid #d1d5db",
      borderRadius: 8,
      padding: "10px 20px",
      fontSize: 14,
      cursor: "pointer",
    },
    hotkey: { fontSize: 12, color: "#9ca3af", marginTop: 8 },
    status: (type) => ({
      marginTop: 12,
      fontSize: 14,
      fontWeight: 600,
      color:
        type === "correct" ? "#059669" : type === "wrong" ? "#dc2626" : "#6b7280",
      minHeight: 20,
    }),
    doneWrap: { textAlign: "center", padding: "2rem 0" },
    overrideItem: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "10px 0",
      borderTop: "1px solid #e5e7eb",
      fontSize: 14,
      textAlign: "left",
    },
    overrideBtn: (marked) => ({
      fontSize: 12,
      padding: "4px 10px",
      borderRadius: 99,
      border: "1px solid",
      cursor: "pointer",
      whiteSpace: "nowrap",
      ...(marked
        ? { background: "#ecfdf5", color: "#065f46", borderColor: "#6ee7b7" }
        : { background: "#f9fafb", color: "#374151", borderColor: "#d1d5db" }),
    }),
  };

  // ── Render: Upload ────────────────────────────────────────────────────
  if (screen === "upload") {
    return (
      <div style={s.wrap}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Quiz Bowl Buzzer</h1>
        <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 15 }}>
          Upload a CSV with <code>question</code> and <code>answer</code> columns to get started.
        </p>
        <div style={s.uploadBox}>
          <input
            type="file"
            accept=".csv"
            id="csvfile"
            style={{ display: "none" }}
            onChange={handleFile}
          />
          <div>
            <button style={s.uploadBtn} onClick={() => document.getElementById("csvfile").click()}>
              Upload CSV
            </button>
          </div>
          <p style={s.uploadHint}>question, answer columns required · questions will be shuffled</p>
        </div>
      </div>
    );
  }

  // ── Render: Done ──────────────────────────────────────────────────────
  if (screen === "done") {
    return (
      <div style={s.wrap}>
        <div style={s.doneWrap}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>All done!</h2>
          <p style={{ color: "#6b7280", fontSize: 15 }}>
            You got {correctCount} out of {questions.length} correct.
          </p>

          {flagged.length > 0 && (
            <div style={{ marginTop: 24, textAlign: "left" }}>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                These were marked wrong — override if you think they should count:
              </p>
              {flagged.map((item, i) => (
                <div key={i} style={s.overrideItem}>
                  <span style={{ flex: 1, color: "#6b7280", lineHeight: 1.5 }}>
                    {item.q.question.slice(0, 80)}{item.q.question.length > 80 ? "…" : ""}
                  </span>
                  <button style={s.overrideBtn(item.overridden)} onClick={() => toggleOverride(i)}>
                    {item.overridden ? "Marked correct" : "Mark correct"}
                  </button>
                </div>
              ))}
              <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12 }}>
                Adjusted score: {adjustedScore} of {questions.length}
              </p>
            </div>
          )}

          <button style={{ ...s.startBtn, marginTop: 24 }} onClick={restartGame}>
            Play again
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Game ──────────────────────────────────────────────────────
  const buzzDisabled = !started || buzzed || phase === "result";

  return (
    <div style={s.wrap}>
      {/* Meta row */}
      <div style={s.metaRow}>
        <span>Question {qIndex + 1} of {questions.length}</span>
        <div style={s.pills}>
          <span style={s.pill("correct")}>{correctCount} correct</span>
          <span style={s.pill("wrong")}>{wrongCount} incorrect</span>
        </div>
      </div>

      {/* Speed slider */}
      <div style={s.speedRow}>
        <span style={s.speedLabel}>Reading speed</span>
        <input
          type="range" min={1} max={5} step={1} value={speed}
          disabled={started}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 13, fontWeight: 500, minWidth: 16 }}>{speed}</span>
      </div>

      {/* Question box */}
      <div style={s.qBox}>
        {displayed}
        {phase === "typing" && (
          <span style={{
            display: "inline-block", width: 2, height: "1.1em",
            background: "#1a1a1a", marginLeft: 2, verticalAlign: "text-bottom",
            animation: "blink 0.7s steps(1) infinite",
          }} />
        )}
      </div>

      {/* Main timer */}
      <div style={s.timerWrap}>
        <div style={s.timerLabel}>
          Time remaining: {phase === "postread" ? postTimeLeft : timeLeft}s
        </div>
        <TimerBar
          value={phase === "postread" ? postTimeLeft : timeLeft}
          max={phase === "postread" ? POST_READ_TIME : TOTAL_TIME}
          color={phase === "postread" ? postColor : timerColor}
        />
      </div>

      {/* Buzz timer */}
      {phase === "answering" && (
        <div style={{ marginBottom: 16 }}>
          <div style={s.timerLabel}>Answer time: {buzzTimeLeft}s</div>
          <TimerBar value={buzzTimeLeft} max={BUZZ_TIME} color={buzzColor} />
        </div>
      )}

      {/* Answer input */}
      {phase === "answering" && (
        <div style={s.answerRow}>
          <input
            ref={answerRef}
            style={s.input}
            value={answerVal}
            onChange={(e) => setAnswerVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
            placeholder="Type your answer..."
          />
          <button style={s.submitBtn} onClick={submitAnswer}>Submit</button>
        </div>
      )}

      {/* Prompt input */}
      {phase === "prompted" && (
        <div style={{ marginBottom: 16 }}>
          <div style={s.promptLabel}>Prompt — please be more specific:</div>
          <div style={s.answerRow}>
            <input
              ref={promptRef}
              style={s.input}
              value={promptVal}
              onChange={(e) => setPromptVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
              placeholder="Type your answer..."
            />
            <button style={s.submitBtn} onClick={submitPrompt}>Submit</button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={s.controls}>
        {!started && (
          <button style={s.startBtn} onClick={startQuestion}>Start question</button>
        )}
        <button style={s.buzzBtn(buzzDisabled)} disabled={buzzDisabled} onClick={buzz}>
          Buzz in
        </button>
        {showNext && (
          <button style={s.nextBtn} onClick={nextQuestion}>Next question</button>
        )}
      </div>

      <div style={s.hotkey}>
        J — start &nbsp;·&nbsp; Space — buzz in &nbsp;·&nbsp; J — next question
      </div>

      {/* Status */}
      {status.text && <div style={s.status(status.type)}>{status.text}</div>}

      {/* Blink keyframe */}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}
