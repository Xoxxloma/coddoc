package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "week_window", schema = "ledger")
public class WeekWindow {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "agronomist_number", nullable = false)
  private String agronomistNumber;

  @Column(name = "week_start", nullable = false)
  private LocalDate weekStart;

  private String reason;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private WindowStatus status = WindowStatus.REQUESTED;

  @Column(name = "opened_at")
  private LocalDateTime openedAt;
}
