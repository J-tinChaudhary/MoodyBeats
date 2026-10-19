INSERT INTO moods (id, label) VALUES
  ('relaxed', 'Relaxed'),
  ('heartbreak', 'Heartbreak'),
  ('romantic', 'Romantic'),
  ('rainy', 'Rainy day'),
  ('upbeat', 'Upbeat')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO genres (id, label) VALUES
  ('bollywood', 'Bollywood'),
  ('indie', 'Indie'),
  ('acoustic', 'Acoustic'),
  ('pop', 'Pop'),
  ('folk', 'Folk')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO collections (id, title, description, symbol, color, tags) VALUES
  ('chai-chill', 'Chai Ki Tapri', 'Slow sips, familiar voices, and a little room to breathe between errands.', '☕', 'chai', ARRAY['chai break','easy listening','acoustic']),
  ('bus-safar', 'Bus Safar', 'Window-seat songs for the long way home and the road beyond the city.', '↗', 'safar', ARRAY['journey','road songs','sing-along']),
  ('radio', 'Radio', 'A hand-picked radio-style sequence for serendipitous listening. Not a live broadcast.', '◉', 'radio', ARRAY['curated mix','shuffle','old and new']),
  ('bollywood', 'Old Is Gold', 'A shelf for retro Hindi film songs. The starter seed has no fitting classic entries yet.', '✦', 'gold', ARRAY['retro Hindi','film songs','nostalgia']),
  ('rainy-day', 'Baarish Ki Khidki', 'Rain on the window, a warm cup, and songs to stay in for.', '☂', 'rainy', ARRAY['rainy day','soft','reflective']),
  ('romance', 'Shaam-e-Ishq', 'Tender film songs and ghazal-inspired moods for a slow evening.', '♡', 'romance', ARRAY['romantic','ghazal-inspired','evening']),
  ('heartbreak', 'Dil Se Desi', 'Hindi favorites for the days when a song says what you cannot.', '♫', 'heartbreak', ARRAY['heartfelt','Hindi','reflective']),
  ('galiyon-ke-geet', 'Galiyon Ke Geet', 'Lively, rootsy sounds for a lane-side gathering and an open-hearted mood.', '✿', 'gali', ARRAY['folk','lively','street sounds']),
  ('indie', 'Nukkad Indie', 'Independent Indian voices for the corner chai stall and the walk after.', '◎', 'indie', ARRAY['Indian indie','acoustic','independent']),
  ('raat-ki-local', 'Raat Ki Local', 'City lights, last trains, and a soundtrack for the ride across town.', '☾', 'night', ARRAY['late night','city','travel']),
  ('sunday-doordarshan', 'Sunday Doordarshan', 'A shelf for family-viewing-era favorites. The starter seed has no fitting entries yet.', '▣', 'sunday', ARRAY['nostalgia','family','Hindi film']),
  ('safar-e-sufi', 'Safar-e-Sufi', 'A gentle, devotional-inspired listening stop along the inner journey.', '✧', 'sufi', ARRAY['sufi-inspired','reflective','devotional mood'])
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  symbol = EXCLUDED.symbol,
  color = EXCLUDED.color,
  tags = EXCLUDED.tags;

INSERT INTO songs (id, title, artist, moods, genres, spotify_track_id) VALUES
  ('iktara', 'Iktara', 'Kavita Seth, Amitabh Bhattacharya', ARRAY['relaxed','romantic'], ARRAY['bollywood','acoustic'], NULL),
  ('shaam', 'Shaam', 'Amit Trivedi, Nikhil D''Souza, Neuman Pinto', ARRAY['relaxed','romantic'], ARRAY['bollywood','acoustic'], NULL),
  ('kasoor', 'Kasoor', 'Prateek Kuhad', ARRAY['relaxed','romantic','rainy'], ARRAY['indie','acoustic'], NULL),
  ('alag-aasmaan', 'Alag Aasmaan', 'Anuv Jain', ARRAY['relaxed','heartbreak'], ARRAY['indie','acoustic'], NULL),
  ('channa-mereya', 'Channa Mereya', 'Arijit Singh', ARRAY['heartbreak'], ARRAY['bollywood'], NULL),
  ('agar-tum-saath-ho', 'Agar Tum Saath Ho', 'Alka Yagnik, Arijit Singh', ARRAY['heartbreak','romantic'], ARRAY['bollywood'], NULL),
  ('phir-le-aya-dil', 'Phir Le Aya Dil', 'Arijit Singh', ARRAY['heartbreak','relaxed'], ARRAY['bollywood','folk'], NULL),
  ('tune-jo-na-kaha', 'Tune Jo Na Kaha', 'Mohit Chauhan', ARRAY['heartbreak','rainy'], ARRAY['bollywood','acoustic'], NULL),
  ('hawayein', 'Hawayein', 'Arijit Singh', ARRAY['romantic','relaxed'], ARRAY['bollywood','pop'], NULL),
  ('raabta', 'Raabta', 'Arijit Singh', ARRAY['romantic'], ARRAY['bollywood','pop'], NULL),
  ('nazm-nazm', 'Nazm Nazm', 'Arko', ARRAY['romantic','relaxed'], ARRAY['bollywood','acoustic'], NULL),
  ('raataan-lambiyan', 'Raataan Lambiyan', 'Jubin Nautiyal, Asees Kaur', ARRAY['romantic','rainy'], ARRAY['bollywood','pop'], NULL),
  ('baarishein', 'Baarishein', 'Anuv Jain', ARRAY['rainy','romantic','heartbreak'], ARRAY['indie','acoustic'], NULL),
  ('saibo', 'Saibo', 'Shreya Ghoshal, Tochi Raina', ARRAY['rainy','romantic','relaxed'], ARRAY['bollywood','acoustic'], NULL),
  ('kabira', 'Kabira (Encore)', 'Arijit Singh, Harshdeep Kaur', ARRAY['rainy','heartbreak'], ARRAY['bollywood','folk'], NULL),
  ('ilahi', 'Ilahi', 'Arijit Singh', ARRAY['upbeat'], ARRAY['bollywood','pop'], NULL),
  ('galliyan', 'Galliyan', 'Ankit Tiwari', ARRAY['romantic','heartbreak'], ARRAY['bollywood','pop'], NULL),
  ('patakha-guddi', 'Patakha Guddi', 'Nooran Sisters', ARRAY['upbeat'], ARRAY['bollywood','folk'], NULL),
  ('husn', 'Husn', 'Anuv Jain', ARRAY['heartbreak','romantic'], ARRAY['indie','acoustic'], NULL),
  ('cold-mess', 'Cold/Mess', 'Prateek Kuhad', ARRAY['rainy','heartbreak','relaxed'], ARRAY['indie','acoustic'], NULL)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  artist = EXCLUDED.artist,
  moods = EXCLUDED.moods,
  genres = EXCLUDED.genres;

DELETE FROM collection_songs
WHERE collection_id IN (
  'chai-chill', 'bus-safar', 'radio', 'bollywood', 'rainy-day', 'romance',
  'heartbreak', 'galiyon-ke-geet', 'indie', 'raat-ki-local',
  'sunday-doordarshan', 'safar-e-sufi'
);

INSERT INTO collection_songs (collection_id, song_id) VALUES
  ('chai-chill', 'iktara'), ('chai-chill', 'shaam'), ('chai-chill', 'kasoor'),
  ('chai-chill', 'alag-aasmaan'), ('chai-chill', 'cold-mess'), ('chai-chill', 'saibo'),
  ('bus-safar', 'ilahi'), ('bus-safar', 'patakha-guddi'), ('bus-safar', 'kabira'),
  ('bus-safar', 'raataan-lambiyan'), ('bus-safar', 'hawayein'), ('bus-safar', 'alag-aasmaan'),
  ('bus-safar', 'baarishein'),
  ('radio', 'iktara'), ('radio', 'shaam'), ('radio', 'patakha-guddi'), ('radio', 'kasoor'),
  ('radio', 'channa-mereya'), ('radio', 'ilahi'), ('radio', 'saibo'), ('radio', 'husn'),
  ('rainy-day', 'kasoor'), ('rainy-day', 'tune-jo-na-kaha'), ('rainy-day', 'raataan-lambiyan'),
  ('rainy-day', 'baarishein'), ('rainy-day', 'saibo'), ('rainy-day', 'kabira'),
  ('rainy-day', 'cold-mess'),
  ('romance', 'iktara'), ('romance', 'shaam'), ('romance', 'kasoor'),
  ('romance', 'agar-tum-saath-ho'), ('romance', 'hawayein'), ('romance', 'raabta'),
  ('romance', 'nazm-nazm'), ('romance', 'raataan-lambiyan'), ('romance', 'saibo'),
  ('romance', 'husn'),
  ('heartbreak', 'alag-aasmaan'), ('heartbreak', 'channa-mereya'), ('heartbreak', 'agar-tum-saath-ho'),
  ('heartbreak', 'phir-le-aya-dil'), ('heartbreak', 'tune-jo-na-kaha'), ('heartbreak', 'baarishein'),
  ('heartbreak', 'kabira'), ('heartbreak', 'husn'), ('heartbreak', 'cold-mess'),
  ('galiyon-ke-geet', 'patakha-guddi'), ('galiyon-ke-geet', 'ilahi'),
  ('galiyon-ke-geet', 'kabira'), ('galiyon-ke-geet', 'phir-le-aya-dil'),
  ('galiyon-ke-geet', 'galliyan'),
  ('indie', 'kasoor'), ('indie', 'alag-aasmaan'), ('indie', 'baarishein'),
  ('indie', 'husn'), ('indie', 'cold-mess'),
  ('raat-ki-local', 'shaam'), ('raat-ki-local', 'ilahi'), ('raat-ki-local', 'hawayein'),
  ('raat-ki-local', 'kasoor'), ('raat-ki-local', 'baarishein'), ('raat-ki-local', 'cold-mess'),
  ('safar-e-sufi', 'patakha-guddi'), ('safar-e-sufi', 'kabira'),
  ('safar-e-sufi', 'phir-le-aya-dil'), ('safar-e-sufi', 'iktara')
ON CONFLICT (collection_id, song_id) DO NOTHING;
