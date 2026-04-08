package org.tongatron.chat;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class ChatFirebaseService extends FirebaseMessagingService {

    private static final String TAG = "ChatFCM";
    private static final String CHANNEL_ID = "chat_messages";
    private static final String PREFS_NAME = "chat_prefs";
    private static final String KEY_FCM_TOKEN = "fcm_token";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "New FCM token: " + token);
        // Save token locally — the WebView JS will pick it up and send to server
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Log.d(TAG, "Message received: " + message.getData());

        String title = message.getData().get("title");
        String body = message.getData().get("body");

        if (title == null && message.getNotification() != null) {
            title = message.getNotification().getTitle();
            body = message.getNotification().getBody();
        }

        if (title == null) title = "Chat";
        if (body == null) body = "Nuovo messaggio";

        // Don't show notification if app is in foreground and chat is visible
        if (MainActivity.isActive) return;

        showNotification(title, body);
    }

    private void showNotification(String title, String body) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify((int) System.currentTimeMillis(), builder.build());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Messaggi Chat", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Notifiche nuovi messaggi");
            channel.enableVibration(true);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
