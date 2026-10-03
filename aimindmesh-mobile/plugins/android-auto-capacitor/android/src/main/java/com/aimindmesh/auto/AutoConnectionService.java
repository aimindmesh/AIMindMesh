package com.aimindmesh.auto;

import android.content.pm.ApplicationInfo;

import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;
import androidx.annotation.NonNull;

public class AutoConnectionService extends CarAppService {
    /**
     * Release builds accept only the known car hosts (Android Auto, Android Automotive) from
     * the library's allowlist, so no other app can bind and read the agenda shown in the car.
     * Debuggable builds also accept the Desktop Head Unit and test hosts.
     */
    @NonNull
    @Override
    public HostValidator createHostValidator() {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
        }
        return new HostValidator.Builder(getApplicationContext())
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build();
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new AutoSession();
    }
}
