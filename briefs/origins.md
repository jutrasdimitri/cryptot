# ORIGINS — Before Bitcoin: The 25-Year Road to Satoshi

Most people think Bitcoin appeared out of nowhere in 2008, invented by a mysterious stranger in a single flash of genius. The real story is better. Bitcoin was the finish line of a race that ran for about **25 years** — a relay of cryptographers, dreamers, and stubborn idealists, each carrying one piece of the puzzle before dropping it. Satoshi was the one who finally put the pieces together. Here is the road that led there.

## 1983 — David Chaum invents money you can't trace

In 1983, American cryptographer **David Chaum** published a strange and beautiful idea: the **blind signature**. Picture signing a document inside a sealed envelope without ever seeing what's inside — you vouch for it, but you can't read it, and later nobody can prove which envelope was yours. Chaum realized this trick could make **digital cash**: a bank could sign virtual coins without being able to trace who spent them or where. Money that works like cash — private, bearer-style — but on a computer. Almost everything in this story grows from that seed.

In **1989**, Chaum founded **DigiCash** in Amsterdam to build it. His system, **eCash**, ran real trials in the mid-1990s — actual banks, actual payments. It worked. But it had the flaw that would kill every attempt for the next two decades: **one company sat in the middle**, and you had to trust it. DigiCash went bankrupt in **1998**. The technology was right. The structure was wrong.

## 1992 — The cypherpunks: "We write code"

In **1992**, a small group of programmers, mathematicians, and privacy activists in California started a mailing list that would become legendary: the **cypherpunks**. Their creed, written by **Eric Hughes** in **"A Cypherpunk's Manifesto" (1993)**, was simple: privacy in the digital age won't be given by governments or companies — *"Cypherpunks write code."* If you want private money, don't lobby for it. **Build it.** Almost every person in the rest of this story walked through that mailing list.

## 1996 — e-gold, and a curious paper from the NSA

Two very different things happened in 1996. First, **e-gold** launched: an online currency backed by real gold stored in vaults. It was not private or decentralized, but it proved ordinary people *wanted* internet money — it grew to millions of accounts before legal pressure over money laundering shut it down in the late 2000s. Same lesson as DigiCash: a center that can be squeezed will be.

Second — and this one is a documented fact, not a rumor: in **June 1996**, three researchers at the U.S. **National Security Agency** — Laurie Law, Susan Sabett, and Jerry Solinas — published a paper called **"How to Make a Mint: The Cryptography of Anonymous Electronic Cash."** It surveyed the state of the art, mostly Chaum-style systems, and worked through hard problems like anonymity and double-spending. Experts who have read it closely, including Adam Back, note that what it describes is a **centralized** mint system — a research paper *about* digital cash, not a blueprint for Bitcoin. The paper is real. What people build on top of that fact is another matter — see the sensitive topics below.

## 1997–2004 — The missing pieces, one by one

- **Hashcash (1997).** Cypherpunk **Adam Back** proposed making email spammers burn a little computer work — a "proof of work" stamp — for every message sent. A tiny cost for honest users, ruinous for spammers sending millions. That humble anti-spam trick became the engine of Bitcoin mining.
- **b-money (1998).** **Wei Dai** published a sketch of money created by computation itself, tracked by a community instead of issued by a bank. It was never built — but Satoshi cited it in the Bitcoin whitepaper.
- **Bit Gold (designed 1998, described publicly 2005).** **Nick Szabo** — who had already coined the term **"smart contracts"** in **1994** — designed digital gold: scarce bits, minted by proof of work, timestamped, held without any trusted company. It was never launched, and it's the closest anyone came before Satoshi. Satoshi later said Bitcoin could be considered an implementation of ideas like b-money and Bit Gold.
- **RPOW (2004).** **Hal Finney** took Back's proof of work and made the tokens *reusable* — transferable digital cash, running on a real server. A working ancestor. Five years later, Finney would receive the very first Bitcoin transaction, sent by Satoshi.

## 2008 — The moment everything came together

Then came the crisis. In the autumn of **2008**, banks collapsed, governments bailed them out with public money, and trust in the financial system hit a generational low. On **October 31, 2008**, in the middle of it, a nine-page paper appeared on a cryptography mailing list: *"Bitcoin: A Peer-to-Peer Electronic Cash System"*, by **Satoshi Nakamoto**. Its references pointed openly at Dai and Back. Three months later, on **January 3, 2009**, the first block was mined, carrying a newspaper headline about bank bailouts — a timestamp, and a statement of purpose, frozen in the code forever.

## The lesson of the road

Every attempt before Bitcoin — DigiCash, e-gold, the rest — died of the same disease: **a center**. A company to bankrupt, a server to seize, an issuer you had to trust. Satoshi's breakthrough wasn't inventing the pieces; Chaum, Back, Dai, Szabo, and Finney had built those over 25 years. The breakthrough was the arrangement — a system with no mint, no office, and no boss, where the double-spending problem was solved by the network itself. Bitcoin didn't come from nowhere. It came from a quarter-century of people refusing to give up on one idea: money that belongs to the person holding it.

## Preset questions

- "Who were the cypherpunks?"
- "Did the NSA really write about crypto money in 1996?"
- "What failed before Bitcoin worked?"
- "Who almost invented Bitcoin first?"

## Sensitive topics — never state without care

- **Satoshi's identity.** Unknown. Full stop. Many names have been proposed — Szabo, Finney, Back, and others — and some have claimed the title themselves; in March 2024, a UK High Court judge ruled that claimant Craig Wright is *not* Satoshi. None of it is proof. The only widely accepted proof would be cryptographic: a signature or a transaction from Satoshi's earliest keys. Until that exists, every identification is a **legend**, and the Historian presents it as one.
- **"Satoshi = the CIA / the NSA created Bitcoin."** Speculation, always labeled as such. The documented facts are only these: the 1996 NSA paper exists (and describes a centralized, Chaum-style system), and SHA-256 — the hash function Bitcoin uses — comes from the SHA-2 family designed by the NSA and published in 2001, a fact in the open. Jumping from those facts to "an agency built Bitcoin" is a leap with **no evidence** behind it. The Historian states the facts, names the leap, and stops there.
- **Name games.** People point out that a Japanese cryptographer cited in the NSA paper's orbit is named Tatsuaki Okamoto, which sounds a bit like "Satoshi Nakamoto." Resemblance is not evidence, and the Historian says so.
- **Dates that blur.** Chaum's blind-signature paper is cited as 1982 or 1983 depending on the source (presented 1982, proceedings published 1983) — either is acceptable, presented as "early 1980s" if pressed. Bit Gold was *designed* in 1998 but only *described publicly* in 2005 — never say it "launched." e-gold's peak account numbers are reported figures, not audited ones.
