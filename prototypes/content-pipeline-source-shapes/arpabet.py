"""PROTOTYPE (spike #44) — is ARPAbet -> IPA mechanical? Find where it stops being one."""
import json, re
d = json.load(open("out/records.json"))["records"]

MAP = {"AA":"ɑ","AE":"æ","AH":"ʌ","AO":"ɔ","AW":"aʊ","AY":"aɪ","B":"b","CH":"tʃ","D":"d",
 "DH":"ð","EH":"ɛ","ER":"ɝ","EY":"eɪ","F":"f","G":"ɡ","HH":"h","IH":"ɪ","IY":"i","JH":"dʒ",
 "K":"k","L":"l","M":"m","N":"n","NG":"ŋ","OW":"oʊ","OY":"ɔɪ","P":"p","R":"ɹ","S":"s",
 "SH":"ʃ","T":"t","TH":"θ","UH":"ʊ","UW":"u","V":"v","W":"w","Y":"j","Z":"z","ZH":"ʒ"}
VOWELS = {k for k in MAP if k in
 {"AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"}}

def naive(phones):
    """Straight phone-by-phone substitution, stress mark emitted at the vowel."""
    out = []
    for p in phones.split():
        m = re.match(r"^([A-Z]+)([0-2])?$", p)
        base, stress = m.group(1), m.group(2)
        if stress == "1": out.append("ˈ")
        elif stress == "2": out.append("ˌ")
        out.append(MAP[base])
    return "".join(out)

rows = []
for w, r in sorted(d.items()):
    for pron in r["cmudict"]:
        rows.append((w, pron, naive(pron)))

print(f"{'word':16} {'CMUdict ARPAbet':38} naive IPA")
for w, p, i in rows:
    print(f"{w:16} {p:38} /{i}/")

covered = [w for w, r in d.items() if r["cmudict"]]
print(f"\ncoverage: {len(covered)}/{len(d)} = {len(covered)/len(d):.0%}")
print("uncovered:", [w for w, r in d.items() if not r["cmudict"]])
print("multiple pronunciations:", {w: len(r["cmudict"]) for w, r in d.items() if len(r["cmudict"]) > 1})
print("\nreduced-vowel ambiguity (AH0 = schwa, AH1 = STRUT; same symbol, different IPA):")
for w, p, _ in rows:
    if "AH0" in p and "AH1" in p:
        print(f"  {w:16} {p}")
