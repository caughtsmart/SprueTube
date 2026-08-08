# Compliance checklist

SprueTube hosts user-generated content, runs advertising, and is operated from
the UK. That combination carries real obligations. This file lists what the
software already does, and what still needs a decision from a person.

**This is not legal advice.** It is an honest description of what the code does,
written so that whoever does give legal advice has something accurate to work
from.

---

## Still needs a human — blocks launch

- [ ] **Name the operating entity.** Set `OPERATOR.legalName` in
      `app/lib/legal.ts`. Both documents read from it, so they cannot disagree.
      For a limited company that is the registered name plus `companyNumber`;
      for a sole trader it is the trading name and `companyNumber` stays null.
      The address is prefilled from the Loaded Dice Shopify billing record —
      confirm it is the right address for service before publishing.
      While `legalName` is unset, both pages carry a visible "not reviewed yet"
      warning, which clears itself once it is filled in.
- [ ] **ICO registration.** Most UK organisations processing personal data must
      register with the Information Commissioner's Office and pay the annual
      data protection fee. Put the number in `OPERATOR.icoNumber`; the privacy
      notice then states it, and omits the sentence entirely while it is null.
- [ ] **Have the privacy notice and terms reviewed.** They are complete and
      accurate about the software's behaviour, which is the hard part — but a
      solicitor should read them before launch.
- [ ] **Set the "last updated" date.** `LEGAL_UPDATED` in `app/lib/legal.ts`,
      one value for both pages. Null until reviewed — a legal document carrying
      a date from before anyone read it is worse than one carrying none.
- [ ] **Make `safety@spruetube.app` and `privacy@spruetube.app` reach a human.**
      Cloudflare Email Routing does this for free. Both addresses are published
      in the app, so they must not bounce.
- [ ] **Decide who moderates, and when.** One person is enough at this size, but
      "nobody looks at the queue at weekends" is a decision you should make
      deliberately rather than discover.

## Online Safety Act (UK)

SprueTube is a user-to-user service accessible in the UK, so the Act applies
regardless of size. Small services have lighter duties, not no duties.

**Built:**

- [x] Reporting on every post, comment and profile, in two taps
- [x] Reports prioritised by severity, not arrival order — child safety, illegal
      content and threats jump the queue
- [x] Blocking (mutual invisibility, follow edges severed) and muting
- [x] Content removal and account suspension, with the user notified
- [x] Append-only audit log of every moderation decision, including dismissals
- [x] Terms that set out what is not allowed, and what happens
      (`app/routes/rules.tsx`)
- [x] A published safety page explaining how it all works and how to appeal
- [x] 13+ age gate at onboarding, date of birth stored for the check and never
      shown publicly

**Still to do:**

- [ ] **Write an illegal content risk assessment.** The Act requires one. For a
      miniature-painting site the honest answer is that most categories are low
      risk, but "low risk, here is why" written down is what compliance looks
      like. Ofcom publishes a template for small services.
- [ ] **Decide the response-time commitment** for illegal content and publish it
      on the safety page.
- [ ] Review Ofcom's codes of practice as they apply to a service this size.

## UK GDPR

**Built:**

- [x] Privacy notice covering what is collected, why, the lawful basis, who it
      is shared with, and retention
- [x] Data minimisation — no analytics tracking, no data sales, date of birth
      used only for the age check
- [x] Account deletion cascades to posts, comments, follows and media
- [x] Passwords hashed by better-auth; never stored or logged in the clear
- [x] Sessions expire after 30 days

**Still to do:**

- [ ] **A subject access request process.** The notice promises a response within
      one month. Decide who does it and how.
- [ ] **A data breach process.** Serious breaches must reach the ICO within 72
      hours. Know in advance who makes that call.
- [ ] **Cookie consent, if AdSense is enabled.** The session cookie is strictly
      necessary and needs no consent. Advertising cookies do. A consent banner
      is required *before* AdSense goes live, not after.
- [ ] Confirm Cloudflare's data processing terms cover the setup (they publish a
      standard DPA).

## Advertising

**Built:**

- [x] Every ad slot labelled "Advertisement"
- [x] Shop links carry `rel="sponsored"`; user links carry `rel="nofollow ugc"`
- [x] The About page states plainly that Loaded Dice funds the site and that
      paint links may earn a referral

**Still to do:**

- [ ] **Cookie consent before AdSense.** See above.
- [ ] Read Google's Publisher Policies once there is real content. The relevant
      risk here is UGC: an ad-serving site is responsible for the pages ads
      appear on, which is another argument for the moderation queue being kept
      clear.
- [ ] If SprueTube ever accepts paid placement directly, UK CAP rules require it
      to be identifiable as advertising — the existing label covers this, keep
      it.

## Before an iOS app (deferred, but the list does not change)

App Store guideline 1.2 applies to every app with user-generated content, and
review does check:

- [x] A way to filter objectionable material — sensitive-content blurring
- [x] A way to report content — on every object
- [x] A way to block abusive users
- [x] Published contact details
- [ ] **Act on reports within 24 hours.** This is a commitment about operations,
      not a feature. Review has been known to ask.
- [ ] **Sign in with Apple**, required by guideline 4.8 as soon as any other
      social login is offered. The code supports it; the secrets need setting.
- [ ] An age rating that reflects UGC — expect 12+ or 17+.
- [ ] A privacy nutrition label matching what the privacy notice actually says.

## Intellectual property

- [x] Terms make clear users keep their rights and grant only an operating
      licence — no rights grab
- [x] Recasts and pirated STL files explicitly banned in the rules
- [ ] **A takedown process** for copyright complaints. The report reason exists;
      what is missing is a documented route and a named recipient.
- [ ] Be careful with trade marks. Warhammer, Citadel, Games Workshop and the
      rest belong to their owners. Using them descriptively — "posts about
      Warhammer 40,000" — is normal and fine. Using them as branding is not.
