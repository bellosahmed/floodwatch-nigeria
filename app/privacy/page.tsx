import type { Metadata } from "next";
import LegalBanner, { contactLine } from "@/components/LegalBanner";

export const metadata: Metadata = { title: "Privacy · FloodWatch" };
export const dynamic = "force-dynamic";

export default function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <LegalBanner />
      <p className="lead">The short version: you do not need an account, reporting flooding never asks for your name or phone number, and we keep little. Phone alerts are optional, and only then do we ask for your number.</p>

      <h2>What you give us when you report flooding</h2>
      <p>
        The state, the local government (if you pick one), the place you describe, how bad it is, and an optional note, plus
        the time. <b>Reports are public.</b> Please do not write names, phone numbers or addresses of people. We remove web links,
        email addresses and phone numbers automatically, but that is a safety net and not perfect.
      </p>

      <h2>The anonymous code in your browser</h2>
      <p>
        Your browser keeps a random code so that one person is counted once and spam can be limited. We store only a
        one-way scrambled version of it. It is not linked to your name, phone, or location. Clearing your browser data
        resets it.
      </p>

      <h2>If you sign up for phone alerts</h2>
      <p>
        We ask for your mobile number, the state (and local government, if you choose one), what you want warnings about, and
        how serious it must be before we message you. We also record that you agreed, and when. We send a 6-digit code to the
        number to check it is yours. Nothing starts until you enter it, and unconfirmed sign-ups are deleted after a day.
      </p>
      <ul>
        <li>Your number is stored <b>encrypted</b>, and is used only to send you the alerts you asked for. We never sell it or use it for marketing.</li>
        <li>Every message has a link to stop. Stopping <b>deletes your number</b> and all your alert settings right away.</li>
        <li>To send a message we pass your number and the message text to our SMS or WhatsApp provider. Your mobile network may charge its usual rates.</li>
        <li>We keep a log of messages sent, to control cost and abuse. It holds a scrambled fingerprint of the number, not the number, and is deleted after 90 days.</li>
      </ul>

      <h2>Your internet address</h2>
      <p>
        Used briefly, in memory, to slow down abuse (for example someone sending hundreds of fake reports). It is not saved in our
        database. Our hosting provider may keep ordinary server logs that include it.
      </p>

      <h2>Cookies and tracking</h2>
      <p>
        We set no cookies for visitors and run no advertising or analytics trackers. (The moderators who review reports get one cookie so they can stay signed in.) If the bot check (Cloudflare Turnstile) is switched on
        for the report form, Cloudflare may use what it needs to tell people from bots.
      </p>

      <h2>Other services involved</h2>
      <ul>
        <li>Weather and river data come from Open-Meteo. Your device does not contact them; our server does.</li>
        <li>Our website host and database provider store the data on our behalf.</li>
        <li>Cloudflare Turnstile, only if switched on.</li>
        <li>Our SMS or WhatsApp provider, only if you sign up for phone alerts.</li>
      </ul>

      <h2>How long we keep things</h2>
      <p>
        Reports are kept for up to 5 years, because past reports help us learn to predict floods better. River gauge readings
        are kept for 30 days. A moderator can hide a report at any time.
      </p>

      <h2>Your rights</h2>
      <p>
        Under Nigerian data protection law you can ask what we hold, ask us to correct it, or ask us to delete it. Because
        reports are anonymous we may need you to describe the report so we can find it. {contactLine()}
      </p>

      <h2>Not for emergencies</h2>
      <p>If you are in danger, call 112 or your State Emergency Management Agency. This site is not an emergency service.</p>
    </>
  );
}
