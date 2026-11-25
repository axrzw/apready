import {
  AlertTriangle, ArrowLeft, ArrowRight, ArrowUpDown, AudioLines, BarChart3, Bird, CalendarDays, CalendarRange, Camera, Cat, Check, ChevronDown, ChevronUp, CircleSlash, Clapperboard,
  Copy, Crown, Disc3, Download, Eraser, Eye, Feather, Fish, Flag, Flame, Gem, Ghost, Hash, Image as ImageIcon, LayoutGrid, Leaf, Library, Lightbulb, Link2, LogOut, Mic, Mic2, Moon,
  Music2, PaintBucket, Palette, Pause, Pen, Play, Plus, Radio, RectangleVertical, Redo2, RotateCcw, ScrollText, Search, Send, Settings2, Shield, Shuffle, SkipForward, SlidersHorizontal,
  Sparkles, Star, Sun, Swords, Tag, Trash2, Trophy, Undo2, UserRound, Users, Volume2, VolumeX, Wrench, X, Zap, Rocket, Timer, Video, VideoOff, MessageSquare, Hand, Scissors, Languages, Rows3, ThumbsUp, Pin, Headphones,
  type LucideIcon,
} from "lucide-react";

/** Every icon the UI uses, by name (modes and avatars store the name). */
export const ICONS: Record<string, LucideIcon> = {
  AlertTriangle, ArrowLeft, ArrowRight, ArrowUpDown, AudioLines, BarChart3, Bird, CalendarDays, CalendarRange, Camera, Cat, Check, ChevronDown, ChevronUp, CircleSlash, Clapperboard,
  Copy, Crown, Disc3, Download, Eraser, Eye, Feather, Fish, Flag, Flame, Gem, Ghost, Hash, Image: ImageIcon, LayoutGrid, Leaf, Library, Lightbulb, Link2, LogOut, Mic, Mic2, Moon,
  Music2, PaintBucket, Palette, Pause, Pen, Play, Plus, Radio, RectangleVertical, Redo2, RotateCcw, ScrollText, Search, Send, Settings2, Shield, Shuffle, SkipForward, SlidersHorizontal,
  Sparkles, Star, Sun, Swords, Tag, Trash2, Trophy, Undo2, UserRound, Users, Volume2, VolumeX, Wrench, X, Zap, Rocket, Timer, Video, VideoOff, MessageSquare, Hand, Scissors, Languages, Rows3, ThumbsUp, Pin, Headphones,
};

export function Icon({ name, size = 18, className, strokeWidth = 1.5 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  const C = ICONS[name] ?? ICONS.Sparkles;
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden />;
}
