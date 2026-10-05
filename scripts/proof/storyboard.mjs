// Proof storyboard: a ~40 s TxtYa-style explainer, same beats as the Invideo reference
// (https://www.youtube.com/watch?v=UYIHUdeTmPY): scattered apps → notification overload → "why force it?" →
// logo → one message, every channel (split screen) → fan-out → end card. Each scene's length follows its voice line.
// The URL on the end card is a placeholder — the real one wasn't confirmed.
export const NAME = "TxtYa";

const CHAT = [
  { from: "Coach Dana", text: "Practice moves to 6pm tonight.", via: "SMS", color: "#10b981" },
  { from: "Sam", text: "Got it, thanks!", via: "Chat app", color: "#22c55e" },
  { from: "Priya", text: "Can someone bring the cones?", via: "Email", color: "#3b82f6" },
  { me: true, text: "I'll bring them. See you all at 6.", via: "Sent to all", color: "#0e7490" },
];

export const SCENES = [
  { id: "s1", minDur: 4.5, voice: "Your people are spread across a dozen different apps.",
    motion: { template: "iconOrbit", params: { headline: "Everyone's on a different app" } } },
  { id: "s2", minDur: 4.5, voice: "Texts, chats, emails, and notifications that never stop.",
    motion: { template: "notificationSwarm", params: { headline: "Notification overload" } } },
  { id: "s3", minDur: 3.5, voice: "So why force everyone onto one more app?",
    wan: "network", overlay: { template: "kineticText", params: { words: ["Why", "force", "it?"] } } },
  { id: "s4", minDur: 3.2, voice: `Meet ${NAME}.`,
    motion: { template: "logoReveal", params: { name: NAME, tagline: "CROSS-CHANNEL GROUP COMMUNICATION" } } },
  { id: "s5", minDur: 5.5, voice: "Send one message, and it reaches every group member on the channel they already use.",
    split: { left: "hands1", leftFocus: 0.3, right: "hands2", center: { template: "chatUI", params: { msgs: CHAT, bare: true } } } },
  { id: "s6", minDur: 5, voice: "Text, chat apps, email, or team chat. Every reply comes back to one conversation.",
    motion: { template: "fanOut", params: { headline: "One message. Every channel." } } },
  { id: "s7", minDur: 5, voice: `${NAME}. Group communication, across every channel.`,
    wan: "earth", overlay: { template: "endCard", params: { name: NAME, tagline: "Group communication, across every channel", url: "txtya.com" } } },
];

/** Wan 2.2 hero shots (text-to-video). Portrait for the split-screen panels. */
export const SHOTS = [
  { id: "network", seconds: 5, prompt: "Macro shot of glowing cyan fiber optic strands in the dark, bright points of light travelling along the strands, deep navy blue background, soft bokeh, bright glowing, high contrast, cinematic slow camera push" },
  { id: "earth", seconds: 5, prompt: "Planet Earth seen from space at night, slowly rotating, bright glowing cyan network arcs connecting cities across the continents, city lights, thin blue atmosphere glow, stars, cinematic, high contrast, bright glowing" },
  // hands1 = the first Wan test (landscape 1280×704); the panel crop is aimed at the phone (focus = x fraction).
  { id: "hands1", seconds: 5, prompt: "Close-up of a person's hands holding a modern smartphone in a dark room, the phone screen glows bright cyan and lights the hands, chat message bubbles on screen, shallow depth of field, cinematic, photorealistic, bright glowing screen, navy blue background" },
  { id: "hands2", seconds: 5, width: 704, height: 1280, prompt: "A young woman smiling as she reads her smartphone at night on a city street, the glowing screen lights her face with cyan light, blue neon bokeh behind her, cinematic, photorealistic, shallow depth of field" },
];
