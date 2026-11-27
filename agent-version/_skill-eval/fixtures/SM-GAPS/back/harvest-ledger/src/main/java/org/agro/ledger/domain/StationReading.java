package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import lombok.Getter;
import org.hibernate.annotations.Immutable;

@Getter
@Entity
@Immutable
@Table(name = "station_reading", schema = "weathergrid")
public class StationReading {
  @Id
  private Long id;

  @Column(name = "region_id")
  private Long regionId;

  @Column(name = "reading_date")
  private LocalDate readingDate;

  @Column(name = "precipitation_mm")
  private BigDecimal precipitationMm;
}
