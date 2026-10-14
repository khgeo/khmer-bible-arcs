#!/usr/bin/env python3
"""Build the data files for the Khmer Bible cross-reference arc diagram.

Inputs
  --xref   cross_references.txt from OpenBible.info (CC-BY)
  --bible  KhmerBFBSBible.xml (Beblia/Holy-Bible-XML-Format) — used ONLY for
           the chapter/verse structure. The Khmer text itself is NOT copied
           into this repo; the web page loads it live at runtime.
Outputs (in --out)
  meta.json            books, Khmer names, verses per chapter
  chapter_links.json   chapter-pair arcs  [chA, chB, count, maxVotes]
  xref/<OSIS>.json     verse-level refs for each source book
"""
import argparse, json, os, xml.etree.ElementTree as ET
from collections import defaultdict

OSIS = ["Gen","Exod","Lev","Num","Deut","Josh","Judg","Ruth","1Sam","2Sam","1Kgs","2Kgs","1Chr","2Chr","Ezra","Neh","Esth","Job","Ps","Prov","Eccl","Song","Isa","Jer","Lam","Ezek","Dan","Hos","Joel","Amos","Obad","Jonah","Mic","Nah","Hab","Zeph","Hag","Zech","Mal",
        "Matt","Mark","Luke","John","Acts","Rom","1Cor","2Cor","Gal","Eph","Phil","Col","1Thess","2Thess","1Tim","2Tim","Titus","Phlm","Heb","Jas","1Pet","2Pet","1John","2John","3John","Jude","Rev"]
KM = ["លោកុប្បត្តិ","និក្ខមនំ","លេវីវិន័យ","ជនគណនា","ចោទិយកថា","យ៉ូស្វេ","ពួកចៅហ្វាយ","នាងរស់","១ សាំយូអែល","២ សាំយូអែល","១ ពង្សាវតារក្សត្រ","២ ពង្សាវតារក្សត្រ","១ របាក្សត្រ","២ របាក្សត្រ","អែសរ៉ា","នេហេមា","អេសធើរ","យ៉ូប","ទំនុកដំកើង","សុភាសិត","សាស្ដា","បទចំរៀង","អេសាយ","យេរេមា","បរិទេវ","អេសេគាល","ដានីយ៉ែល","ហូសេ","យ៉ូអែល","អេម៉ុស","អូបាឌា","យ៉ូណាស","មីកា","ណាហ៊ុម","ហាបាគុក","សេផានា","ហាកាយ","សាការី","ម៉ាឡាគី",
      "ម៉ាថាយ","ម៉ាកុស","លូកា","យ៉ូហាន","កិច្ចការ","រ៉ូម","១ កូរិនថូស","២ កូរិនថូស","កាឡាទី","អេភេសូរ","ភីលីព","កូឡុស","១ ថែស្សាឡូនីច","២ ថែស្សាឡូនីច","១ ធីម៉ូថេ","២ ធីម៉ូថេ","ទីតុស","ភីលេម៉ូន","ហេព្រើរ","យ៉ាកុប","១ ពេត្រុស","២ ពេត្រុស","១ យ៉ូហាន","២ យ៉ូហាន","៣ យ៉ូហាន","យូដាស","វិវរណៈ"]
EN = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth","1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Songs","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
      "Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"]

ap = argparse.ArgumentParser()
ap.add_argument("--xref", required=True); ap.add_argument("--bible", required=True); ap.add_argument("--out", required=True)
a = ap.parse_args()

root = ET.parse(a.bible).getroot()
chap_verses = []            # per book: list of verse counts per chapter
for b in root.iter("book"):
    chap_verses.append([max(int(v.get("number")) for v in c.findall("verse")) for c in b.findall("chapter")])
assert len(chap_verses) == 66

# global indices
vbase = {}  # (book, ch) -> first verse index
chap_index = {}; gi = 0; ci = 0
for bi, chs in enumerate(chap_verses):
    for c, n in enumerate(chs, 1):
        vbase[(bi, c)] = gi; chap_index[(bi, c)] = ci; gi += n; ci += 1
NV, NC = gi, ci
bidx = {o: i for i, o in enumerate(OSIS)}

def parse(ref):
    b, c, v = ref.split(".")
    bi = bidx[b]; c = int(c); v = int(v)
    if (bi, c) not in vbase or v > chap_verses[bi][c - 1]: return None
    return bi, c, vbase[(bi, c)] + v - 1

per_book = defaultdict(list); pairs = {}; skipped = 0; kept = 0
with open(a.xref, encoding="utf-8") as f:
    next(f)
    for line in f:
        fr, to, votes = line.rstrip("\n").split("\t")[:3]
        votes = int(votes)
        if votes <= 0: continue
        s = parse(fr); t0, _, t1 = to.partition("-")
        t = parse(t0); e = parse(t1) if t1 else None
        if not s or not t: skipped += 1; continue
        kept += 1
        per_book[s[0]].extend([s[2], t[2], (e[2] if e else t[2]), votes])
        ca, cb = chap_index[(s[0], s[1])], chap_index[(t[0], t[1])]
        if ca == cb: continue
        k = (min(ca, cb), max(ca, cb))
        p = pairs.get(k)
        if p: p[0] += 1; p[1] = max(p[1], votes)
        else: pairs[k] = [1, votes]

os.makedirs(os.path.join(a.out, "xref"), exist_ok=True)
dump = lambda o, p: open(os.path.join(a.out, p), "w", encoding="utf-8").write(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
dump({"verses": NV, "chapters": NC,
      "books": [{"osis": OSIS[i], "km": KM[i], "en": EN[i], "ch": chap_verses[i]} for i in range(66)],
      "source": {"xref": "OpenBible.info cross references (CC-BY)", "text": "ព្រះគម្ពីរបរិសុទ្ធ ១៩៥៤ (ពគប) — loaded live"}}, "meta.json")
links = sorted(([k[0], k[1], v[0], v[1]] for k, v in pairs.items()), key=lambda r: r[3])
dump(links, "chapter_links.json")
for bi, arr in per_book.items(): dump(arr, f"xref/{OSIS[bi]}.json")
print(f"verses={NV} chapters={NC} refs kept={kept} skipped={skipped} chapter arcs={len(links)}")
