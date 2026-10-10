import { useCallback } from "react";

type NumpadProps = {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  enterLabel?: string;
  hideEnter?: boolean;
  disabled?: boolean;
};

export default function Numpad({ value, onChange, onEnter, enterLabel = "ตกลง", hideEnter = false, disabled = false }: NumpadProps) {
  const handleKey = useCallback((key: string) => {
    if (key === "clear") {
      onChange("");
    } else if (key === "backspace") {
      onChange(value.slice(0, -1));
    } else {
      // Don't allow multiple dots
      if (key === "." && value.includes(".")) return;
      // Start fresh if it's currently 0 and user types a number
      if (value === "0" && key !== ".") {
        onChange(key);
      } else {
        onChange(value + key);
      }
    }
  }, [value, onChange]);

  return (
    <div className="numpad">
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("7")}>7</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("8")}>8</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("9")}>9</button>

      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("4")}>4</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("5")}>5</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("6")}>6</button>

      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("1")}>1</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("2")}>2</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("3")}>3</button>

      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey(".")}>.</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("0")}>0</button>
      <button disabled={disabled} type="button" className="numpad-btn" onClick={() => handleKey("backspace")}>⌫</button>

      {!hideEnter && <button disabled={disabled} type="button" className="numpad-btn enter" onClick={onEnter}>{enterLabel}</button>}
    </div>
  );
}
