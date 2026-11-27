package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "measurement_entry", schema = "ledger")
public class MeasurementEntry {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "agronomist_number", nullable = false)
  private String agronomistNumber;

  @Column(name = "entry_date", nullable = false)
  private LocalDate entryDate;

  @Column(name = "plot_id")
  private Long plotId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private EntryStatus status = EntryStatus.DRAFT;

  @Column(name = "decided_by")
  private String decidedBy;

  @Column(name = "decision_comment")
  private String decisionComment;

  @Column(name = "updated_at", nullable = false)
  private LocalDateTime updatedAt = LocalDateTime.now();

  @OneToMany(mappedBy = "entry", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<EntryValue> values = new ArrayList<>();
}
