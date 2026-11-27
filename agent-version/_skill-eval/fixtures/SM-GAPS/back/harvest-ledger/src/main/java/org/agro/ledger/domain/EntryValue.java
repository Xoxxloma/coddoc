package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "entry_value", schema = "ledger")
public class EntryValue {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "entry_id")
  private MeasurementEntry entry;

  @ManyToOne(optional = false)
  @JoinColumn(name = "crop_id")
  private Crop crop;

  @Column(nullable = false)
  private BigDecimal value;
}
