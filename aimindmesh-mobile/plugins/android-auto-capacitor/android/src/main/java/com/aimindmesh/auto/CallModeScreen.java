package com.aimindmesh.auto;

import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Template;
import android.content.Intent;
import android.content.ComponentName;
import androidx.annotation.NonNull;

public class CallModeScreen extends Screen {
    public CallModeScreen(CarContext carContext) {
        super(carContext);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        return new MessageTemplate.Builder("Tap microphone to start talking")
                .setTitle("AI Assistant")
                .setHeaderAction(Action.BACK)
                .addAction(
                        new Action.Builder()
                                .setTitle("Start Listening")
                                .setOnClickListener(this::startVoiceInteraction)
                                .build())
                .build();
    }

    private void startVoiceInteraction() {
        // Trigger the voice interaction service or activity
        // For now, we'll try to start the main voice activity or service intent
        try {
            Intent intent = new Intent(Intent.ACTION_VOICE_COMMAND);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getCarContext().startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
