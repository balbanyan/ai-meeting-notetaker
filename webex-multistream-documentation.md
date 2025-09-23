## Webex Meetings
## Multistream Quickstart
With multistream, developers gain greater flexibility when displaying remote media streams. Instead of receiving a single stream featuring all participants, multistream enables the showcasing of multiple streams simultaneously. This means you can easily view each remote participant's stream individually, enhancing clarity and engagement during collaborative sessions.

This guide provides a quick glimpse into consuming multistream in Webex Meetings using the Webex JavaScript SDK. You'll find code snippets below that can quickly get you up and running.

Initialize the SDK
anchor
To work with the multistream feature you'll need to install via npm or yarn or reference via an HTML <script> tag, the Meetings Web SDK version 3.1.0 or higher:

NPM
npm install webex
Yarn
yarn add webex
HTML
<script defer src="https://unpkg.com/webex@3.7.0/umd/webex.min.js"></script>
Enable Multistream
anchor
To integrate multistream functionality into your meetings, include the enableMultistream flag within the joinOptions parameter when calling either the meeting.join() or meeting.joinWithMedia() methods:

const joinOptions = {
  enableMultistream: true,
  ...
};

// Use either the join() method:

await meeting.join(joinOptions);

// ...or the joinWithMedia() method:

await meeting.joinWithMedia({joinOptions, mediaOptions});
For additional details, see Join a Meeting.

Build the Layout
anchor
The layout determines how the various streams are positioned and displayed in the user interface. In order to create the layout with remote streams:

Create HTML container elements (for example a <div>) for the video streams:

<div id="multistream-remote-video" style="display: flex">
  <!-- All the remote videos will render here -->
</div>
For each streams

Create an HTML <video> element and attach the remoteMedia.stream.

// Create an html "video" element and attach the `remoteMedia.stream`
function createVideoElement(stream) {
  const videoElement = document.createElement('video');
  videoElement.srcObject = stream;
  videoElement.height = 480;
  videoElement.width = 620;
  videoElement.autoplay = true;
  videoElement.muted = true;

  return videoElement;
}
(Optional) Add elements for name label, overlay and overlay text elements to display participant information on top of the video streams.

Append all the video elements to the container element.

const remoteVideoContainerElm = document.getElementById('multistream-remote-video');

function updateTheLayout(activeSpeakerVideoElems, memberVideoElems) {
  [...activeSpeakerVideoElems, ...memberVideoElems].forEach((videoElement) => {
    // Append all the video elements to the container element
    remoteVideoContainerElm.appendChild(videoElement);
  });
}
Setup Remote Media Event Listeners
anchor
Once you've joined a meeting successfully, the meetings backend will start sending the remote streams which can be received by listening to the following two events:

When multistream is enabled, media cannot be accessed or listened to on the media:ready event. Instead, you should listen to the media events received during a meeting that pertain to multistream, such as media:remoteVideo:layoutChanged, to handle media streams appropriately.

media:remoteAudio:created - For remote audio streams.
media:remoteVideo:layoutChanged - For remote video streams including active speaker, participants and screen sharing.
Attach Audio Streams
You'll need to define HTML elements to which you'll attach the audio streams. For example:

<!-- Audio elements -->
<audio id="multistream-remote-audio-0" class="multistream-remote-audio" autoplay></audio>
<audio id="multistream-remote-audio-1" class="multistream-remote-audio" autoplay></audio>
<audio id="multistream-remote-audio-2" class="multistream-remote-audio" autoplay></audio>
You can only receive a maximum of 3 audio streams from active speakers at a time.

To bind the streams to the HTML elements, you can use the following JavaScript snippet:

meeting.on('media:remoteAudio:created', (audioMediaGroup) => {
  audioMediaGroup.getRemoteMedia().forEach((media, index) => {
    document.getElementsByClassName('multistream-remote-audio')[index].srcObject = media.stream;
  });
});
Attach Video Streams
Now, let's link all the remote video and screenshare streams here by listening for the media:remoteVideo:layoutChanged event and updating the video elements accordingly:

const remoteScreenshareElm = document.getElementById('remote-screenshare');

const activeSpeakerVideoElems = [];
const memberVideoElems = [];

meeting.on('media:remoteVideo:layoutChanged', ({
  layoutId, activeSpeakerVideoPanes, memberVideoPanes, screenShareVideo
}) => {
  for (const [groupId, group] of Object.entries(activeSpeakerVideoPanes)) {
    group.getRemoteMedia().forEach((remoteMedia, index) => {
      // Attach the "remoteMedia.stream" of active speakers to video elements
      if(remoteMedia.sourceState === 'live') {
        activeSpeakerVideoElems.push(createVideoElement(remoteMedia.stream));
      }
    });
  }

  // The Staged layout has memberVideoPanes defined. Read through the comprehensive guide for more details.
  for (const [paneId, remoteMedia] of Object.entries(memberVideoPanes)) {
    // Attach the "remoteMedia.stream" of member videos to video elements
    if(remoteMedia.sourceState === 'live') {
      memberVideoElems.push(createVideoElement(remoteMedia.stream));
    }
  }

  updateTheLayout(activeSpeakerVideoElems, memberVideoElems);

  if (screenShareVideo) {
    // Attach the "screenShareVideo.stream" to a video element
    remoteScreenshareElm.srcObject = screenShareVideo.stream;
  }
});
Now that you've witnessed multistream in action, for a more thorough understanding and access to all available features, see the Multistream Comprehensive Guide.

Kitchen Sink App
anchor
To experiment with more features of multistream, see the Meeting Samples App.

When using the sample app, in the Manage Meeting section, select the checkbox labeled Use a multistream connection (which automatically sets enableMultistream to true and passes it to the join() methods) before clicking on Join Meeting or Join with Media:

Enable multistream in the sample app

Enabling the Use a multistream connection replaces Remote Video fieldset with Multistream Remote Videos under the Streams section.






## Webex Meetings
## Multistream Comprehensive Guide
Developers have a variety of options to customize how they choose to display remote videos with multistream media.

The initial step in utilizing Multistream is to include enableMultistream within the joinOptions parameter for both the meeting.join() and meeting.joinWithMedia() methods.

Example

const joinOptions = {
  enableMultistream: true,
  ...
};

await meeting.join(joinOptions);

// or

await meeting.joinWithMedia({joinOptions, mediaOptions});
This article is divided into three sections:

Layouts: Determines the preferred visualization of the remote streams.
Events: Monitors all remote streams and additional events.
Methods and RemoteMediaManager: Facilitates layout updates and other operations.
Terminology

Throughout this document we'll refer to the following terms:

Layout: An arrangement of remote streams in the user interface.
Pane: An individual element within the layout grid.
Remote Media: The media stream and associated details.
Remote Media Group: A collection of remote media as a group, along with additional helper APIs.
CSI: A unique identifier linked to a stream, connecting a member participant with that stream.
Layout
anchor
A "layout" refers to the arrangement of remote streams in the user interface. Multistream allows you to customize this layout. To do so, call addMedia() with the desired layout details. The existing arguments for addMedia() are unaffected by this process. For more information, refer to this documentation.

The AddMediaOptions now includes a new property, remoteMediaManagerConfig, for multistream functionality. To implement a custom layout, you can use the same data format as shown in the predefined layouts.

The following are the default configuration values for remoteMediaManagerConfig, which are used if no overrides are provided:

const remoteMediaManagerConfig = {
  audio: {
    numOfActiveSpeakerStreams: 3,
    numOfScreenShareStreams: 1,
  },
  video: {
    preferLiveVideo: true,
    initialLayoutId: 'AllEqual',

    layouts: {
      AllEqual: AllEqualLayout,
      OnePlusFive: OnePlusFiveLayout,
      Single: SingleLayout,
      Stage: Stage2x2With6ThumbnailsLayout,
      ScreenShareView: RemoteScreenShareWithSmallThumbnailsLayout,
    }
  }
}
A detailed explanation of this object can be found here.

Here are the predefined layouts for the default configuration:


Type	Description
AllEqual	All equal (max 9).
OnePlusFive	One big pane + five small.
Single	Single Video pane.
Stage	Stage with thumbnails.
ScreenShareView	Screen share with thumbnails.
Layout Details
The following setions describe each available layout in detail.

AllEqual
An "all equal" grid, with size up to 3 x 3 = 9.

All equal grid

Example

const AllEqualLayout: VideoLayout = {
  activeSpeakerVideoPaneGroups: [
    {
      id: 'main',
      numPanes: 9,
      size: 'best',
      priority: 255,
    },
  ],
};
OnePlusFive
A layout with one big pane for the highest-priority active speaker and 5 small panes for other active speakers.

One plus 5 layout

Example

const OnePlusFiveLayout: VideoLayout = {
  activeSpeakerVideoPaneGroups: [
    {
      id: 'mainBigOne',
      numPanes: 1,
      size: 'large',
      priority: 255,
    },
    {
      id: 'secondarySetOfSmallPanes',
      numPanes: 5,
      size: 'very small',
      priority: 254,
    },
  ],
};
Single
A layout with a single remote active speaker video pane.

Single remote speaker video pane

Example

const SingleLayout: VideoLayout = {
  activeSpeakerVideoPaneGroups: [
    {
      id: 'main',
      numPanes: 1,
      size: 'best',
      priority: 255,
    },
  ],
};
Stage
A staged layout with four pre-selected meeting participants in the main 2x2 grid and 6 small panes for other active speakers at the top.

The predetermined participants can be included using the CSI value, which can be updated once the values are accessible after joining the meeting.

Staged layout

Example

const Stage2x2With6ThumbnailsLayout: VideoLayout = {
  activeSpeakerVideoPaneGroups: [
    {
      id: 'thumbnails',
      numPanes: 6,
      size: 'thumbnail',
      priority: 255,
    },
  ],
  memberVideoPanes: [
    {id: 'stage-1', size: 'medium', csi: undefined},
    {id: 'stage-2', size: 'medium', csi: undefined},
    {id: 'stage-3', size: 'medium', csi: undefined},
    {id: 'stage-4', size: 'medium', csi: undefined},
  ],
};
ScreenShareView
A strip of eight small video panes (thumbnails) displayed at the top of a remote screenshare.

Eight small video panes

Example

const RemoteScreenShareWithSmallThumbnailsLayout: VideoLayout = {
  screenShareVideo: {size: 'best'},
  activeSpeakerVideoPaneGroups: [
    {
      id: 'thumbnails',
      numPanes: 8,
      size: 'thumbnail',
      priority: 255,
    },
  ],
};
RemoteMediaManager Configuration Object
This object configures the RemoteMediaManager. Based on this configuration, you will receive the multistream remote media.

{
  audio: {
    numOfActiveSpeakerStreams: number; 
    numOfScreenShareStreams: number; 
  };
  video: {
    preferLiveVideo: boolean; 
    initialLayoutId: LayoutId;

    layouts: {[key: LayoutId]: VideoLayout}; 
  };
}
Properties of the Audio Object

Name	Description	Type
numOfActiveSpeakerStreams	The maximum number of speakers that can be heard simultaneously.	Number
numOfScreenShareStreams	The maximum number of screenshare streams. Typically, one should suffice as only one person can present at a time in Webex.	Number
Properties of Video Object

Name	Description	Type
preferLiveVideo	If set to true, the server prioritizes sending streams of participants with their video enabled over those that don't send video.	boolean
initialLayoutId	One of the keys defined within the layouts object.	string
layouts	Key-value pairs where the value determines the layout. Additional details are provided in the following table.	object
Properties of VideoLayout Object

Name	Description	Type
screenShareVideo	Defines the screenshare stream.	{ size: PaneSize }
activeSpeakerVideoPaneGroups	Defines the active speaker panes.	Array<ActiveSpeakerPaneObject>
memberVideoPanes	Defines the member video panes.	Array<MemberPaneObject>
Values for the PaneSize Object

PaneSize	Description
thumbnail	The smallest possible resolution, 90p or less.
very small	180p or less.
small	360p or less.
medium	720p or less.
large	1080p or less.
best	Highest possible resolution.
Properties of ActiveSpeakerPaneObject

Name	Description	Type
id	An arbitrary value.	string
numPanes	The number of streams that you will receive.	number
size	The size of each stream.	PaneSize (string)
priority	The priority of the streams. The most recent active speaker has the highest priority.	number (0-255)
Consider the following scenario with two groups:

Group A: Priority 255, contains 1 video pane
Group B: Priority 254, contains 5 video panes In a meeting with 6 attendees, when person X begins speaking, they appear in Group A. If person Z starts speaking next, Z will be displayed in Group A, and X will move to Group B.
Properties of MemberPaneObject

Name	Description	Type
id	An arbitrary value (e.g., stage-1).	string
size	The size of the stream.	PaneSize (string)
csi	A unique identifier for a stream. When a client generates a stream, it assigns a CSI value to it.	number
Member video panes can only be accessed within the stage layout, which allows for the pinning of specific participants' positions in the layout. The stage layout is created when memberVideoPanes is included in the layout configuration. In this case, developers are responsible for managing and displaying participants as they join or leave. This is different from activeSpeakerVideoPaneGroups, where a consistent list of streams featuring active speakers/participants is always received. Additionally, the active speaker video pane can be pinned. Therefore, participants can be pinned either by using memberVideoPanes or by invoking pinActiveSpeakerVideoPane(remoteMedia, csi) for activeSpeakerVideoPaneGroups.

Each member or participant can have multiple streams. These streams can be of various types such as audio, video, screenshareVideo, or screenshareAudio. Each stream is uniquely identified by a CSI. A member can have more than one stream of the same type. For instance, a user can have two video streams (each with a unique CSI) if they join the meeting using multiple devices.

In most scenarios, you'll primarily utilize activeSpeakerVideoPaneGroups.

Events
anchor
Events can be listened to using the meeting.on() method.

Here's an example:

meeting.on('event name', (data) => {
  console.log(data);
});
When multistream is enabled, media cannot be accessed or listened to on the media:ready event. Instead, you should listen to the media events received during a meeting that pertain to multistream, such as the events mentioned below, to handle media streams appropriately.

meeting.on('media:remoteVideo:layoutChanged', ({
  layoutId, activeSpeakerVideoPanes, memberVideoPanes, screenShareVideo
}) => {
  console.log('layoutId: ', layoutId);
  console.log('activeSpeakerVideoPanes:', activeSpeakerVideoPanes);
  console.log('memberVideoPanes:', memberVideoPanes);
  console.log('screenShareVideo:', screenShareVideo);
});
The event media:remoteVideo:layoutChanged will be triggered with the initialLayoutId the first time, even if there are no changes in the layout.

Media Events
The following table and sections elaborate on the media events received during a meeting that pertain to multistream.


Event name	Data Received
media:remoteAudio:created	List of audio streams (remains unchanged by layout changes).
media:remoteScreenShareAudio:created	Object representing the screen share audio media group.
media:remoteVideo:layoutChanged	{ layoutId, activeSpeakerVideoPanes, memberVideoPanes, screenShareVideo }.
media:remoteVideoSourceCountChanged	Number of remote video sources ({ numTotalSource, numLiveSources }).
media:remoteAudioSourceCountChanged	Number of remote audio sources ({ numTotalSource, numLiveSources }).
media:activeSpeakerChanged	List of member IDs for active speakers ({ memberIds }).
The list of audio streams received in the media:remoteAudio:created event does not contain participant ID information. It is also not possible to correlate a single audio stream with the participant that is speaking.

media:remoteScreenShareAudio:created
To obtain the list of remote media elements from the group, invoke getRemoteMedia().

const remoteMedia = screenShareAudioMediaGroup.getRemoteMedia()[0];
const remoteMediaStream = remoteMedia.stream;
Asynchronous: No

Parameters


Name	Description	Type	Mandatory
filter	A string used to filter and retrieve a specific type of remote media.	all (Default), pinned, unpinned	No
Returns: Array<RemoteMedia>

media:remoteVideo:layoutChanged

Data Received	Description
layoutId	Options: AllEqual, OnePlusFive, Single, Stage, ScreenShareView
activeSpeakerVideoPanes	Contains: groupId, groupRemoteMedia
memberVideoPanes	Contains: paneId, remoteMedia
screenShareVideo	RemoteMedia object: { id, stream, sourceState (either 'no source' or 'live'), memberId }
The layoutId list displayed here corresponds to those defined in the configuration. These IDs may vary depending on your configuration settings.

media:remoteVideoSourceCountChanged

Data Received	Description
numTotalSource	Total number of all video sources.
numLiveSources	Total number of live video sources.
media:remoteAudioSourceCountChanged

Data Received	Description
numTotalSource	Total number of all audio sources.
numLiveSources	Total number of live audio sources.
Meeting Events
The following table and sections elaborate on the meeting events received during a meeting that pertain to multistream.


Event name	Description
meeting:stoppedSharingLocal	The client has stopped screen sharing and no longer has control over it. This can occur when another participant starts sharing and takes control, or if the user stops sharing.
meeting:startedSharingRemote	Another participant in the meeting has started screen sharing and now has control over it.
meeting:stoppedSharingRemote	Another participant in the meeting has stopped screen sharing and no longer has control over it.
Remote Media Events
The remoteMedia object may include streams from various participants and can dynamically update as different participants begin speaking. The memberId within the remoteMedia object allows for the display of corresponding names or data alongside the stream. This memberId can be utilized to retrieve the name of the participant.

Events can be listened to using the remoteMedia.on() method.

Example

remoteMedia.on('Event name', (data) => {
  console.log(data);
});

Event name	Description
sourceUpdate	Triggered when the source of the remoteMedia changes, such as when another participant begins speaking.
stopped	Triggered when the participant has deactivated their stream.
With sourceUpdate, you can inspect the memberId and sourceState to obtain the most recent information about the remoteMedia.

Here's the possible information received during the sourceUpdate event:


Data Received	Description
no source	No video is available.
invalid source	The source is invalid.
live	The video is available.
avatar	The camera is muted or there is no video. An avatar can be shown.
bandwidth disabled	There is insufficient bandwidth to show the video. An avatar can be shown.
policy violation	Video is restricted due to a policy violation.
Methods
anchor
Multiple methods are available for handling various scenarios and updating the layout.

Get an Array of a Member's CSIs
const csiList = meeting.members.getCsisForMember(memberId, mediaType='video', mediaContent='main');
Asynchronous: No

Parameters


Name	Description	Type	Mandatory
memberId	Member's ID.	string	Yes
mediaType	The media type.	audio, video (Default)	No
mediaContent	Type of media content.	main (Default), slides	No
Returns: Array<number>

Find A Member by CSI
const member = meeting.members.findMemberByCsi(csi);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
csi	CSI number linked to the stream.	number	Yes
Returns: Member

Remote Media Manager
anchor
In multistream meetings, the meeting.addMedia() API establishes the media connection. It configures streams to receive remote media based on the remoteMediaManagerConfig provided as an option.

The Meeting.addMedia() method accepts an optional configuration object to set up the RemoteMediaManager:

meeting.addMedia({
  ...,
  remoteMediaManagerConfig?: RemoteMediaManagerConfiguration;
})
RemoteMediaManager configuration object

{
  audio: {
    numOfActiveSpeakerStreams: number; // number of audio streams we want to receive
    numOfScreenShareStreams: number; // 1 should be enough because in Webex only 1 person at a time can be presenting screen share
  };
  video: {
    preferLiveVideo: boolean; // applies to all pane groups with active speaker policy
    initialLayoutId: LayoutId;

    layouts: {[key: LayoutId]: VideoLayout}; // a map of all available layouts, a layout can be set via setLayout() method
  };
}
This object's details are outlined in the Explanation of the RemoteMediaManager Object section.

Set a Remote Video CSI
meeting.remoteMediaManager.setRemoteVideoCsi(remoteMedia, csi);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
remoteMedia	RemoteMedia object.	RemoteMedia	Yes
csi	A new CSI value, can be null if we want to stop receiving media.	number, null	Yes
Returns: void

Add a Member Video Pane
const remoteMedia = await meeting.remoteMediaManager.addMemberVideoPane(
  { id: PaneId; size: PaneSize; csi?: CSI; }
);
Asynchronous: Yes

Parameters:


Name	Description	Type	Mandatory
id	Pane ID.	string	Yes
size	Size of the video pane.	thumbnail, very small, small, medium, large, best	Yes
csi	CSI number associated with the stream.	number	No
Returns: Promise<RemoteMedia>

Get the Currently Selected Layout ID
const layoutId = meeting.remoteMediaManager?.getLayoutId();
Asynchronous: No

Parameters: No

Returns: string

Change the Layout
Calling this method triggers the media:remoteVideo:layoutChanged event.

await meeting.remoteMediaManager.setLayout(layoutId);
Asynchronous: Yes

Parameters:


Name	Description	Type	Mandatory
layoutId	ID of the defined layout.	string	Yes
Returns: Promise<void>

Set the prefer live video
meeting.remoteMediaManager.setPreferLiveVideo(preferLiveVideo);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
preferLiveVideo	If enabled, this option will prioritize retrieving streams with active video.	boolean	Yes
Returns - void

Set Active Speaker CSIs
Set CSIs for multiple RemoteMedia instances belonging to a RemoteMediaGroup.

meeting.remoteMediaManager.setActiveSpeakerCsis(remoteMediaCsis);
Asynchronous: No

Parameters: An array of object with the following properties, for example, Array<{ remoteMedia, csi }>.


Name	Description	Type	Mandatory
remoteMedia	The remote media object.	RemoteMedia	Yes
csi	CSI number associated with the stream.	number	No
Returns: void

For each entry in the remoteMediaCsis array:

If csi is specified, the RemoteMedia instance is pinned to that CSI.
If csi is undefined, the RemoteMedia instance gets unpinned.
Set a Remote Video CSI
Set a new CSI on a given remote media object

meeting.remoteMediaManager.setRemoteVideoCsi(remoteMedia, csi);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
remoteMedia	The remote media object to be altered.	RemoteMedia	Yes
csi	A new CSI value. It can be null if you wish to stop receiving media.	number, null	Yes
Returns - void

Add a Member Video Pane
Add a new member video pane to the currently selected layout.

const remoteMedia = await meeting.remoteMediaManager.addMemberVideoPane(newPane);
Asynchronous: Yes

Parameters:


Name	Description	Type	Mandatory
id	Pane ID.	string	Yes
size	Pane size.	thumbnail, very small, small, medium, large, best	Yes
csi	New CSI value.	number	No
Returns - Promise<RemoteMedia>

Changes to the layout are lost after a layout change.

Remove Member Video Pane
Remove a member video pane from the currently selected layout.

await meeting.remoteMediaManager.removeMemberVideoPane(paneId);
Asynchronous: Yes

Parameters:


Name	Description	Type	Mandatory
paneId	Pane ID.	string	Yes
Returns - Promise<void>

Changes to the layout are lost after a layout change.

Pin an Active Speaker Video Pane
Pin an active speaker remote media object to the given CSI value.

meeting.remoteMediaManager.pinActiveSpeakerVideoPane(remoteMedia, csi);
This function pins an active speaker's remote media object to a specified CSI value. Consequently, the remote media will only play audio/video from that specific CSI. This remains in effect until either the unpinActiveSpeakerVideoPane() function is called or the current layout is altered.

Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
remoteMedia	Reference to the remote media object.	RemoteMedia	Yes
csi	CSI value to pin to. If undefined, the current CSI value is used.	number	No
Returns - void

Unpin Active Speaker Video Pane
Unpin a remote media object from the specific CSI value to which it was previously pinned.

meeting.remoteMediaManager.unpinActiveSpeakerVideoPane(remoteMedia);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
remoteMedia	Remote media object reference.	RemoteMedia	Yes
Returns - void

Pinned
Determine whether a given remote media object is part of an active speaker group and if it has been pinned.

const isPinned = meeting.remoteMediaManager.isPinned(remoteMedia);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
remoteMedia	Remote media object reference.	RemoteMedia	Yes
Returns - boolean

Throws an error if the remote media object doesn't belong to any active speaker remote media group.

Set Size Hint
anchor
Clients can specify a size hint if they are displaying remote video on screens of varying sizes and need to adjust the video resolution for optimal display or bandwidth conservation. When the remote receives this hint, it starts transmitting the video at the requested resolution.

setSizeHint() can be invoked on the remoteMedia object. Each video stream corresponds to a remoteMedia object.

remoteMedia.setSizeHint(width, height);
Asynchronous: No

Parameters:


Name	Description	Type	Mandatory
width	Width of the video element.	number	Yes
height	Height of the video element.	number	Yes
Returns - void

Be Right Back
anchor
The meeting.beRightBack() allows the update of the "be right back" status for the current participant.

It can be used when a participant would like to step away from a meeting for a short period of time. When enabled, the participant's video stream could be replaced with a placeholder image, etc.

This method is applicable only to multistream meetings. It will throw an error if attempted in a non-multistream meeting.

await meeting.beRightBack(true);
Asynchronous: Yes

Parameters:


Name	Description	Type	Mandatory
enabled	Whether or not be right back should be enabled.	boolean	Yes
Returns: Promise<void>

Kitchen Sink App
anchor
To explore Multistream functionality, feel free to explore our Meeting Samples App.

Under Manage Meeting section, check the box with label Use a multistream connection before clicking on Join Meeting or Join with Media.