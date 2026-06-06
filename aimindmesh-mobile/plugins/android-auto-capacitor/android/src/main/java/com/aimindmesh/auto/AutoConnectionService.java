package com.aimindmesh.auto;

import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;
import androidx.annotation.NonNull;

public class AutoConnectionService extends CarAppService {
    @NonNull
    @Override
    public HostValidator createHostValidator() {
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new AutoSession();
    }
}
