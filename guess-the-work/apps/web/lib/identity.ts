/** Player identity choices at login (no accounts): a colour and a line icon. */
export const COLORS = ["#E9B44C", "#D9503F", "#5BC08E", "#5AA9E6", "#B391D9", "#E38BAE", "#6FCDBF", "#C9C2B4"] as const;
export const AVATARS = ["Flame", "Moon", "Sun", "Zap", "Crown", "Swords", "Shield", "Feather", "Gem", "Rocket", "Ghost", "Cat", "Bird", "Fish", "Leaf", "Star"] as const;
export type AvatarId = (typeof AVATARS)[number];
