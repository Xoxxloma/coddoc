package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import org.hibernate.annotations.Immutable;

@Getter
@Entity
@Immutable
@Table(name = "mv_pest_cases", schema = "ledger")
public class PestCaseView {
  @Id
  private Long id;

  @Column(name = "farm_id")
  private Long farmId;

  @Column(name = "region_id")
  private Long regionId;

  @Column(name = "closed_at")
  private LocalDateTime closedAt;
}
