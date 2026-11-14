// Apple Podcasts categories and subcategories.
//
// Transcribed from podcasters.apple.com "Apple Podcasts categories" on
// 2026-09-15, from the **"Corresponding programming"** column — the values that
// go in the feed — not the display column beside it. The two differ, and the
// difference is easy to miss:
//
//   displayed "American Football"   → feed value `Football`
//   displayed "Football (Soccer)"   → feed value `Soccer`
//
// Apple matches these exactly and case-sensitively: `Kids & Family` is valid and
// `Kids & family` is not. Ampersands are written here as plain `&` and escaped
// once, at render time, by the feed builder.
//
// Categories with no subcategories carry an empty list; Apple's guidance is to
// self-close those tags, which is what `categoryTag()` does.

export const APPLE_CATEGORIES: Record<string, string[]> = {
  Arts: ["Books", "Design", "Fashion & Beauty", "Food", "Performing Arts", "Visual Arts"],
  Business: ["Careers", "Entrepreneurship", "Investing", "Management", "Marketing", "Non-Profit"],
  Comedy: ["Comedy Interviews", "Improv", "Stand-Up"],
  Education: ["Courses", "How To", "Language Learning", "Self-Improvement"],
  Fiction: ["Comedy Fiction", "Drama", "Science Fiction"],
  Government: [],
  History: [],
  "Health & Fitness": ["Alternative Health", "Fitness", "Medicine", "Mental Health", "Nutrition", "Sexuality"],
  "Kids & Family": ["Education for Kids", "Parenting", "Pets & Animals", "Stories for Kids"],
  Leisure: [
    "Animation & Manga", "Automotive", "Aviation", "Crafts", "Games", "Hobbies",
    "Home & Garden", "Video Games",
  ],
  Music: ["Music Commentary", "Music History", "Music Interviews"],
  News: [
    "Business News", "Daily News", "Entertainment News", "News Commentary",
    "Politics", "Sports News", "Tech News",
  ],
  "Religion & Spirituality": [
    "Buddhism", "Christianity", "Hinduism", "Islam", "Judaism", "Religion", "Spirituality",
  ],
  Science: [
    "Astronomy", "Chemistry", "Earth Sciences", "Life Sciences", "Mathematics",
    "Natural Sciences", "Nature", "Physics", "Social Sciences",
  ],
  "Society & Culture": ["Documentary", "Personal Journals", "Philosophy", "Places & Travel", "Relationships"],
  Sports: [
    "Baseball", "Basketball", "Cricket", "Fantasy Sports", "Football", "Golf", "Hockey",
    "Rugby", "Running", "Soccer", "Swimming", "Tennis", "Volleyball", "Wilderness", "Wrestling",
  ],
  Technology: [],
  "True Crime": [],
  "TV & Film": ["After Shows", "Film History", "Film Interviews", "Film Reviews", "TV Reviews"],
};
