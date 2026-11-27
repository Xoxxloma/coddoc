package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "handover_request", schema = "ledger")
public class HandoverRequest {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "from_head", nullable = false)
  private String fromHead;

  @Column(name = "to_head", nullable = false)
  private String toHead;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private HandoverStatus status = HandoverStatus.REQUESTED;

  @Column(name = "decided_by")
  private String decidedBy;

  @Column(name = "created_at", nullable = false)
  private LocalDateTime createdAt = LocalDateTime.now();
}
