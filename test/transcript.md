# How to get YouTube transcript with n8n

**Video ID:** 4HQDZ_5CjNk
**URL:** https://www.youtube.com/watch?v=4HQDZ_5CjNk
**Fetched at:** 2026-03-13T05:49:52.774Z

---
Hello everyone. Welcome to today's tutorial. I'm going to be showing you how you can use NAND to grab the transcript of a YouTube video. So, I just have a quick little form over here that just says YouTube transcript generator and there's a single field, which is what we're going to be using to input the URL of the video we want. So, I just grabbed the default video that is

in the ampify actor here. So, I'll just copy this as a quick little threem minute video. So, we're just going to click submit. Come back to our workflow. And now we have the URL. So, the best way to actually scrape the transcript is using uh ampify. We're going to use an app actor called YouTube transcript scraper. So, in order to use

this, what we're going to do is we're going to come over to API, go to API endpoints, and what you're want going to want to do is get this run actor synchronously and get data set items. Going to copy this link here, and you're going to want to make sure it's a post request. So, we're going to come back here, and you're going to paste it into this URL. Change

this to post request. And the last thing we need is the send body parameters. So, we're going to turn this on. And I'm just going to use the JSON field. Come back to the actor. Change this to JSON. Copy that. We need to change this to an expression. But first, I actually need to connect this to the output. Perfect. So, now what we want to do is we want to

change this to the input from our form. Grab this. Perfect. So now what we're going to do is we're going to test a step and it's going to run the actor and usually takes a couple seconds but here we go. It's a short video so that's why it was pretty quick. Um but yes as you can see right now we kind of have a bunch of fields in here with start the duration

text. The thing is with transcripts is they usually split it based on the time time stamp of the video. So first what we're going to want to do is because it's locked within an array here. So, what we want to do is we want to go to split, drag in the data array field. We're going to go ahead run this step. So, now it kind of split out everything into text. But you can see we kind of

have everything sort of split into different JSON items, 101 to be exact. So, what we're going to do is we're going to collect them all into one single line of output. So I'm just going to go ahead and pin this data here. Next going to go to aggregate. And what we're going to do, leave this as individual field. Input the

text. But what we want to do is we want to add merge lists. Turn this on. And what this will do is will combine everything into a single list. So what that will look like is rather than having 101 fields, it'll combine everything into a single output. So as you can see there's only one item. So that is how you can easily get the transcript. Now you can do with this

what you will. You can add it to a spreadsheet, Google Sheets, Air Table or maybe you want to process this transcript using AI. You can add it to an open AI nodes. But that is for a different video. So this is how you can quickly grab the transcript in NADN. Hopefully you found this helpful and thank you for watching.