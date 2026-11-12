// The 15 hazards of the testbed (testbed/README.md). `response` is what the paper finds for that kind of hazard.
export const HAZARDS = [
  { id: "A", name: "Pipe on two pipe stands", where: "apron", x: 6.2, type: "fixed, overhead", height: "1.27 to 1.38", response: "A posture change: the robot squats under it and keeps walking." },
  { id: "B", name: "Steel lintel on jack stands", where: "ramp top", x: 11.0, type: "fixed, overhead", height: "1.20 to 1.34", response: "A posture change, right where the ramp ends." },
  { id: "C", name: "Sprinkler main on pipe stands", where: "corridor", x: 17.7, type: "fixed, overhead", height: "1.27 to 1.38", response: "A posture change while walking." },
  { id: "D", name: "Chain hoist hook left hanging", where: "corridor", x: 19.5, type: "hanging, side", height: "1.00 to 1.18", response: "A twist of the upper body past the hook." },
  { id: "E", name: "Guardrail tube of a rolling scaffold", where: "corridor", x: 21.3, type: "fixed, side", height: "1.04 to 1.13", response: "A twist away from the tube." },
  { id: "F", name: "Conduit drop to a disconnect box", where: "corridor", x: 23.1, type: "fixed, side", height: "1.00 to 1.12", response: "A twist, a bend and a squat together." },
  { id: "G", name: "Pallet hanging from a chain hoist", where: "corridor", x: 24.9, type: "suspended, overhead", height: "1.12 to 1.42", response: "A deep bend with a squat. On a real site, a suspended load should count as a closed zone." },
  { id: "H", name: "Duct held on a duct lift", where: "corridor", x: 26.7, type: "fixed, overhead", height: "1.16 to 1.44", response: "A deep bend with a squat." },
  { id: "I", name: "Steel beam on jack stands", where: "corridor", x: 28.5, type: "fixed, overhead", height: "1.20 to 1.34", response: "A posture change while walking." },
  { id: "J", name: "Cross brace of a rolling scaffold", where: "corridor", x: 30.3, type: "fixed, side", height: "1.02 to 1.55", response: "A squat under the brace." },
  { id: "K", name: "Hammer or pipe dropped from the slab edge", where: "open bay", x: 32.0, type: "falling", height: "from 4.05", moving: true, response: "It falls 4 m in 0.9 s. No response of the robot avoids it reliably. Only a drop zone does." },
  { id: "L", name: "Crane load carried across the walkway", where: "wet slab", x: 34.8, type: "swinging", height: "0.95 to 1.25", moving: true, response: "Timing: wait for the swing to pass, or go before it arrives." },
  { id: "M", name: "Excavator arm slewing across the walkway", where: "debris", x: 38.6, type: "swinging", height: "0.75 to 1.20", moving: true, response: "Keep moving. The arm sweeps the spot where a waiting robot would stand." },
  { id: "N", name: "Crane load being landed", where: "debris", x: 40.2, type: "suspended, overhead", height: "1.12 to 1.42", response: "The hardest fixed hazard: a deep posture on loose ground. The strict option stops and waits for the site to clear it." },
  { id: "O", name: "Worker carrying a pipe or lumber", where: "staging", x: 42.6, type: "carried", height: "0.80 to 0.95, or 1.20 to 1.35", moving: true, response: "Wait and let the worker cross first." },
];
