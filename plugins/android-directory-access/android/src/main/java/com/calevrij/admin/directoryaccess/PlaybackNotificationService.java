package com.calevrij.admin.directoryaccess;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

public class PlaybackNotificationService extends Service {
    public static final String ACTION_UPDATE = "com.calevrij.admin.directoryaccess.UPDATE_MEDIA";
    public static final String ACTION_COMMAND = "com.calevrij.admin.directoryaccess.MEDIA_COMMAND";
    private static final String ACTION_TOGGLE = "toggle";
    private static final String ACTION_REWIND = "rewind";
    private static final String ACTION_FORWARD = "forward";
    private static final String ACTION_BOOKMARK = "bookmark";
    private static final String ACTION_SEEK = "seek";
    private static final String CHANNEL_ID = "calevrij-media-playback";
    private static final int NOTIFICATION_ID = 6142;

    private MediaSession mediaSession;
    private String title = "Reproductor";
    private boolean active;
    private boolean playing;
    private long position;
    private long duration;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        mediaSession = new MediaSession(this, "CaleVRijAdminPlayback");
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { performAction("play", null); }
            @Override public void onPause() { performAction("pause", null); }
            @Override public void onRewind() { performAction(ACTION_REWIND, null); }
            @Override public void onFastForward() { performAction(ACTION_FORWARD, null); }
            @Override public void onSeekTo(long time) { performAction(ACTION_SEEK, time); }
            @Override public void onCustomAction(String action, Bundle extras) {
                if (ACTION_REWIND.equals(action) || ACTION_FORWARD.equals(action) || ACTION_BOOKMARK.equals(action)) {
                    performAction(action, null);
                }
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_UPDATE.equals(action)) {
            active = intent.getBooleanExtra("active", false);
            title = intent.getStringExtra("title") == null ? "Reproductor" : intent.getStringExtra("title");
            playing = intent.getBooleanExtra("isPlaying", false);
            position = Math.max(0, intent.getLongExtra("position", 0));
            duration = Math.max(0, intent.getLongExtra("duration", 0));
            if (!active) {
                stopPlaybackNotification();
                return START_NOT_STICKY;
            }
            updateMediaSession();
            startForegroundNotification();
        } else if (action != null) {
            performAction(action, intent.hasExtra("position") ? intent.getLongExtra("position", 0) : null);
        }
        return START_NOT_STICKY;
    }

    private void performAction(String action, Long seekPosition) {
        if ("play".equals(action)) playing = true;
        else if ("pause".equals(action)) playing = false;
        else if (ACTION_TOGGLE.equals(action)) {
            playing = !playing;
            action = playing ? "play" : "pause";
        }
        else if (ACTION_REWIND.equals(action)) position = Math.max(0, position - 10_000);
        else if (ACTION_FORWARD.equals(action)) position = Math.min(duration > 0 ? duration : Long.MAX_VALUE, position + 10_000);
        else if (ACTION_SEEK.equals(action) && seekPosition != null) position = Math.max(0, Math.min(duration > 0 ? duration : seekPosition, seekPosition));

        Intent event = new Intent(ACTION_COMMAND).setPackage(getPackageName()).putExtra("action", action);
        if (ACTION_SEEK.equals(action) && seekPosition != null) event.putExtra("position", position);
        sendBroadcast(event);
        updateMediaSession();
        if (active) startForegroundNotification();
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;
        mediaSession.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
            .build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_SEEK_TO;
        PlaybackState.Builder state = new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f)
            .addCustomAction(ACTION_REWIND, "−10", android.R.drawable.ic_media_rew)
            .addCustomAction(ACTION_FORWARD, "+10", android.R.drawable.ic_media_ff)
            .addCustomAction(ACTION_BOOKMARK, "Marcador", android.R.drawable.ic_menu_add);
        mediaSession.setPlaybackState(state.build());
    }

    private void startForegroundNotification() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(playing ? "Reproduciendo" : "En pausa")
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setContentIntent(openAppIntent())
            .addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pausa" : "Reproducir", actionIntent(ACTION_TOGGLE, 0)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_rew, "−10", actionIntent(ACTION_REWIND, 1)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_ff, "+10", actionIntent(ACTION_FORWARD, 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_add, "+ Marcador", actionIntent(ACTION_BOOKMARK, 3)).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        Intent intent = new Intent(this, PlaybackNotificationService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, pendingFlags);
    }

    private PendingIntent openAppIntent() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (intent == null) return null;
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 4, intent, pendingFlags);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Reproducción", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Controles de reproducción de CaleVRijAdmin");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void stopPlaybackNotification() {
        active = false;
        playing = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }
}
