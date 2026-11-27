package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "weather_reading", schema = "ledger")
public class WeatherReading {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(optional = false)
  @JoinColumn(name = "import_id")
  private WeatherImport weatherImport;

  @Column(name = "farm_id", nullable = false)
  private Long farmId;

  @Column(name = "reading_date", nullable = false)
  private LocalDate readingDate;

  @Column(name = "precipitation_mm")
  private BigDecimal precipitationMm;

  @Column(name = "temperature_c")
  private BigDecimal temperatureC;
}
