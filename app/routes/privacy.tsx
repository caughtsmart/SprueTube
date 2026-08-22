import { Link } from "react-router";
import { Prose } from "../components/Prose";
import {
  CONTACT_EMAIL,
  LEGAL_UPDATED,
  OPERATOR,
  operatorLine,
  operatorReady,
} from "../lib/legal";

export function meta() {
  return [
    { title: "Privacy — SprueTube" },
    {
      name: "description",
      content: "What data SprueTube holds about you, why, and how to get rid of it.",
    },
  ];
}

export default function Privacy() {
  return (
    <Prose title="Privacy notice" updated={LEGAL_UPDATED ?? undefined}>
      {operatorReady() ? null : (
        <p className="st-text-muted">
          <strong>Before you publish this site:</strong> set the operator in{" "}
          <code>app/lib/legal.ts</code>, and have this notice read by someone
          qualified. It is a complete and honest description of what the
          software actually does, but it is not legal advice.
        </p>
      )}

      <h2>Who we are</h2>
      <p>
        SprueTube is operated by {operatorLine()}. For anything about your data,
        use the <Link to="/contact">contact form</Link> and choose the data
        topic, or email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. The form is
        quicker for us to route, but either reaches the same people and either
        starts the clock below.
      </p>
      {OPERATOR.icoNumber ? (
        <p>
          We are registered with the Information Commissioner's Office under{" "}
          {OPERATOR.icoNumber}.
        </p>
      ) : null}

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Email address, a hashed password (we
          never see the original), display name and username.
        </li>
        <li>
          <strong>Your date of birth.</strong> Collected once to check you are 13
          or over. It is never shown on your profile.
        </li>
        <li>
          <strong>What you post.</strong> Text, photos, comments, likes, follows,
          saved posts, build logs, and any listings you place in the buy-and-sell
          or commission sections.
        </li>
        <li>
          <strong>Private messages.</strong> Messages you send are stored so the
          person you sent them to can read them. They are private from other
          users, but not from moderation: if a message is reported, a moderator
          can read that conversation in order to act on the report. We do not
          read messages otherwise and we never use them for advertising.
        </li>
        <li>
          <strong>Technical data.</strong> IP address and browser user-agent
          against your login sessions, for security and abuse prevention.
        </li>
        <li>
          <strong>Reports.</strong> If you report something, we keep the report,
          what you said, and what we decided.
        </li>
      </ul>
      <p>
        We do not sell personal data and we do not run third-party tracking
        beyond the advertising described below.
      </p>

      <h2>Why we are allowed to hold it</h2>
      <ul>
        <li>
          <strong>Contract:</strong> your account and your posts — we cannot run
          the service without them.
        </li>
        <li>
          <strong>Legal obligation:</strong> the age check, and keeping
          moderation records.
        </li>
        <li>
          <strong>Legitimate interests:</strong> preventing abuse and spam, and
          keeping the site up.
        </li>
        <li>
          <strong>Consent:</strong> optional third-party sign-in, if you choose
          it. You can withdraw it at any time. We do not run personalised
          advertising, so no consent is asked for that.
        </li>
      </ul>

      <h2>Advertising</h2>
      <p>
        Ad slots are labelled as advertisements, and the only advertiser is
        Loaded Dice, the hobby shop that funds SprueTube. There is no
        third-party ad network, no programmatic advertising, and no advertising
        cookies. We count impressions and clicks in aggregate so we know which
        promotions are worth running; nothing is tied to your account.
      </p>

      <h2>Who else sees your data</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong> — hosting, database, image delivery and the
          email that carries password resets. Our infrastructure provider.
        </li>
        <li>
          <strong>Google</strong> — sign-in, if you choose it.
        </li>
        <li>
          <strong>Apple</strong> — sign-in if you choose it.
        </li>
        <li>
          <strong>Law enforcement</strong> — where we are legally required, or
          where there is a serious risk to someone.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account and posts: until you delete them.</li>
        <li>Deleted posts: removed from the site immediately; purged within 30 days.</li>
        <li>Login sessions: 30 days.</li>
        <li>
          Moderation records: up to 2 years, because we may need to show what we
          did and why.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under UK GDPR you can ask for a copy of your data, correct it, delete it,
        restrict or object to how we use it, or take it elsewhere. Ask through
        the <Link to="/contact">contact form</Link>, choosing the data topic, or
        email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Either
        way we will respond within one month.
      </p>
      <p>
        Deleting your account removes your profile, posts, comments and media.
        Moderation records about serious breaches are kept, because deleting them
        would defeat the point of having them.
      </p>
      <p>
        If we get it wrong you can complain to the Information Commissioner's
        Office at{" "}
        <a href="https://ico.org.uk" rel="noopener" target="_blank">
          ico.org.uk
        </a>
        .
      </p>

      <h2>Cookies</h2>
      <p>
        A session cookie keeps you signed in — the site does not work without it.
        We do not use advertising cookies (the only advertiser is Loaded Dice,
        served by us, with no third-party ad network) and we do not use
        analytics cookies.
      </p>
    </Prose>
  );
}
