import { Link } from "react-router";
import { Prose } from "../components/Prose";

export function meta() {
  return [
    { title: "Safety — SprueTube" },
    {
      name: "description",
      content:
        "How reporting, blocking and moderation work on SprueTube, and how to contact the safety team.",
    },
  ];
}

export default function Safety() {
  return (
    <Prose title="Safety">
      <p>
        SprueTube is a user-to-user service based in the UK, which means the
        Online Safety Act applies to it. That is not the reason any of this
        exists, but it does set a floor, and this page is the plain-English
        version of how we meet it.
      </p>

      <h2>Reporting something</h2>
      <p>
        Every post, comment and profile has a <strong>⋯</strong> menu with{" "}
        <strong>Report</strong>. Pick a reason, add context if you have it, send.
        The person you report is never told who reported them.
      </p>
      <p>Reports are not handled in the order they arrive. They are ranked:</p>
      <ul>
        <li>
          <strong>Immediately:</strong> child safety, illegal content, credible
          threats, self-harm.
        </li>
        <li>
          <strong>Same day:</strong> hate speech, harassment, sexual content.
        </li>
        <li>
          <strong>Within a few days:</strong> impersonation, copyright, spam.
        </li>
      </ul>

      <h2>Blocking and muting</h2>
      <ul>
        <li>
          <strong>Block</strong> makes you and that person invisible to each
          other, and removes any follows in either direction.
        </li>
        <li>
          <strong>Mute</strong> quietly removes them from your feeds. They are
          not told and nothing else changes.
        </li>
      </ul>

      <h2>What we do about illegal content</h2>
      <p>
        It is removed as soon as we are aware of it. Child sexual abuse material
        results in immediate termination and referral to the appropriate
        authorities. We keep a record of every moderation decision so we can
        show what was done and when.
      </p>

      <h2>If you are under 18</h2>
      <p>
        Accounts are 13+. If you are under 18, keep identifying details out of
        your posts — school, street, the front of your house in a background
        shot. If an adult on here contacts you in a way that feels wrong, report
        it and email us. We will act on it.
      </p>

      <h2>Contact</h2>
      <p>
        For anything urgent, or to appeal a decision:{" "}
        <a href="mailto:safety@spruetube.app">safety@spruetube.app</a>. A person
        reads that address.
      </p>
      <p>
        If someone is in immediate danger, contact the police first. In the UK
        that is 999, or 101 for something non-urgent.
      </p>
      <p>
        The rules themselves are on the{" "}
        <Link to="/rules">community rules</Link> page.
      </p>
    </Prose>
  );
}
