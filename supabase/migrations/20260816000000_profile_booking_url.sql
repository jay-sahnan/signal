-- The sender's meeting-booking link (Calendly, Cal.com, SavvyCal, Google
-- appointment page, ...). Lives on the sender profile, not user_settings:
-- profiles are the "who is writing" identity that campaigns link to, and a
-- user with two profiles may book into two calendars.
--
-- Read by the compose prompt: whenever a draft's call to action is a call or
-- meeting, the link goes in the email as the way to book. Nullable; a profile
-- without one keeps asking for a reply instead.
alter table user_profile add column if not exists booking_url text;
