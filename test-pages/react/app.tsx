import { useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <main>
      <h1>Campos controlados por React</h1>
      <label>
        Input controlado
        <input id="react-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p>
        Estado de React: <output id="react-input-state">{name}</output>
      </p>
      <label>
        Textarea controlado
        <textarea id="react-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p>
        Estado de React: <output id="react-textarea-state">{notes}</output>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
