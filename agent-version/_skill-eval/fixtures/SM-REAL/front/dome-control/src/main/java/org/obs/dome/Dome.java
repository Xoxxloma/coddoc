package org.obs.dome;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import java.time.Instant;

@Entity
public class Dome {
    @Id
    private String id;

    private String name;

    @Enumerated(EnumType.STRING)
    private DomeState state;

    /** Кто последним менял состояние купола; null — купол ни разу не трогали. */
    private String changedBy;

    private Instant changedAt;

    public enum DomeState { OPEN, CLOSED, MAINTENANCE }

    public String getId() { return id; }
    public String getName() { return name; }
    public DomeState getState() { return state; }
    public void setState(DomeState state) { this.state = state; }
    public void setChangedBy(String changedBy) { this.changedBy = changedBy; }
    public void setChangedAt(Instant changedAt) { this.changedAt = changedAt; }
}
