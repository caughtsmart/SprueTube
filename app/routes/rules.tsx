import { Link } from "react-router";
import { Prose } from "../components/Prose";

export function meta() {
  return [
    { title: "Community rules — SprueTube" },
    {
      name: "description",
      content:
        "The rules for posting on SprueTube, and what happens when someone breaks them.",
    },
  ];
}

export default function Rules() {
  return (
    <Prose title="Community rules">
      <p>
        Short version: this is a hobby site. Behave like you are stood at a
        club table with people you will see again next week.
      </p>

      <h2>What is not allowed</h2>
      <ul>
        <li>
          <strong>Harassment.</strong> Pile-ons, targeted abuse, and following
          someone around to criticise their painting. Critique is welcome when
          it is asked for and useful.
        </li>
        <li>
          <strong>Hate.</strong> Attacks on people for who they are. The
          grimdark setting is fiction; using it as cover for the real thing is
          not.
        </li>
        <li>
          <strong>Sexual content.</strong> Nothing explicit. Miniatures included.
        </li>
        <li>
          <strong>Anything involving minors sexually.</strong> Removed, account
          terminated, reported to the authorities. No exceptions and no appeal.
        </li>
        <li>
          <strong>Illegal content.</strong> Including recasts, pirated STL files
          and stolen digital sculpts.
        </li>
        <li>
          <strong>Passing off someone else's work as yours.</strong> Reposting is
          fine with clear credit and a link. Claiming it is not.
        </li>
        <li>
          <strong>Spam.</strong> Bulk promotion, engagement farming, and dropping
          shop links in unrelated threads.
        </li>
      </ul>

      <h2>Gore, blood and grimdark</h2>
      <p>
        Painted blood, battle damage and horror sculpts are a normal part of this
        hobby and are allowed. If a photo is likely to make someone flinch
        mid-scroll, tick <strong>Blur as sensitive</strong> when you post it. If
        you do not, a moderator may do it for you — that is not a punishment.
      </p>

      <h2>Age</h2>
      <p>
        You must be 13 or over to have an account. We ask for a date of birth
        once, use it for that check, and never show it on your profile.
      </p>

      <h2>What happens if you break them</h2>
      <p>Proportionate to what happened, in roughly this order:</p>
      <ol>
        <li>The post is removed and you are told why.</li>
        <li>Repeated or deliberate breaches suspend the account.</li>
        <li>
          Illegal content, and anything involving child safety, skips straight to
          termination and is referred onwards where the law requires it.
        </li>
      </ol>
      <p>
        Every moderator decision is logged. If you think one was wrong, appeal
        through the <Link to="/contact">contact form</Link> — pick the safety
        topic and a human will look at it again.
      </p>

      <h2>Reporting</h2>
      <p>
        Every post, comment and profile has a <strong>⋯</strong> menu with{" "}
        <strong>Report</strong> in it. Reports are anonymous to the person you
        report. More on how that works on the{" "}
        <Link to="/safety">safety page</Link>.
      </p>
    </Prose>
  );
}
