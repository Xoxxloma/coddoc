package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "plot", schema = "ledger")
public class Plot {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "owner_number", nullable = false)
  private String ownerNumber;

  @Column(name = "farm_id", nullable = false)
  private Long farmId;

  @Column(nullable = false)
  private String name;

  @Column(name = "area_ha")
  private BigDecimal areaHa;

  @Column(nullable = false)
  private boolean archived;
}
